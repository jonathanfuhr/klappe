'use client';

import type { VersionDto } from '@klappe/shared';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { mediaUrl } from '@/lib/api';

/**
 * Adaptive Wiedergabe über HLS (Phase 13).
 *
 * Warum überhaupt beides? Der progressive Proxy ist die Grundlage fürs
 * frame-genaue Arbeiten: eine Datei, sofort springbar, ohne Zwischenschicht.
 * HLS kommt hinzu, wenn die Leiter erzeugt wurde – für Kunden mit schwacher
 * Leitung, denen eine kleinere Stufe lieber ist als ein Ruckler.
 *
 * Safari spielt HLS von Haus aus; Chrome und Firefox brauchen `hls.js`. Das
 * Paket wird deshalb erst geladen, wenn es wirklich gebraucht wird – sonst
 * hinge es in jedem Seitenaufruf mit drin.
 */
export type PlaybackSource = 'progressiv' | 'hls';

/** Eine wählbare Stufe der Leiter. */
export interface HlsQuality {
  /** Index in `hls.levels` – das, was `currentLevel` erwartet. */
  index: number;
  /** Kurze Kante als Name, wie die Leiter sie benennt: „1080p“. */
  label: string;
}

export interface HlsPlayback {
  source: PlaybackSource;
  /**
   * Wählbare Stufen, größte zuerst. Leer beim progressiven Proxy und bei
   * Safaris nativem HLS – dort entscheidet allein der Browser, eine manuelle
   * Wahl gibt es in dessen API schlicht nicht.
   */
  qualities: HlsQuality[];
  /** Vom Nutzer gewählte Stufe; `-1` heißt automatisch (Phase 22). */
  selectedLevel: number;
  /** Name der gerade tatsächlich gespielten Stufe – `null`, solange unbekannt. */
  activeLabel: string | null;
  /** Stufe fest wählen; `-1` gibt die Wahl an die Automatik zurück. */
  setLevel: (index: number) => void;
}

/** Minimaler struktureller Ausschnitt aus hls.js – erspart den statischen Import. */
interface HlsInstanz {
  levels: { width: number; height: number }[];
  currentLevel: number;
  destroy: () => void;
}

export function useHlsSource(
  videoRef: RefObject<HTMLVideoElement | null>,
  version: VersionDto,
  enabled: boolean,
): HlsPlayback {
  const [source, setSource] = useState<PlaybackSource>('progressiv');
  const [qualities, setQualities] = useState<HlsQuality[]>([]);
  const [selectedLevel, setSelectedLevel] = useState(-1);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const instanzRef = useRef<HlsInstanz | null>(null);
  const hatLeiter = version.hlsVariants.length > 0;

  useEffect(() => {
    const video = videoRef.current;
    // Jede neue Fassung beginnt automatisch – eine gemerkte 480p-Wahl vom
    // letzten Video wäre hier nur eine unerklärlich matschige Überraschung.
    setQualities([]);
    setSelectedLevel(-1);
    setActiveLabel(null);
    instanzRef.current = null;

    if (!video || !enabled || !hatLeiter) {
      setSource('progressiv');
      return;
    }

    const url = mediaUrl.hls(version.id);

    // Safari und iOS: HLS geht direkt ans <video>, ganz ohne Bibliothek. Der
    // Preis: Stufenwahl und -anzeige gibt es dort nicht – die native
    // Wiedergabe bietet dafür keine Schnittstelle.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      setSource('hls');
      return;
    }

    let abgebrochen = false;
    let instanz: HlsInstanz | null = null;

    void (async () => {
      try {
        const { default: Hls } = await import('hls.js');
        if (abgebrochen || !Hls.isSupported()) return;

        const hls = new Hls({
          // Die Segmente hängen an der Sitzung; ohne Kekse käme 401 zurück.
          xhrSetup: (xhr) => {
            xhr.withCredentials = true;
          },
        });
        instanz = hls;
        instanzRef.current = hls;

        // Die Stufen stehen erst nach dem Master-Playlist-Parse fest. Benannt
        // wird nach der kurzen Kante – dieselbe Sprache wie die Leiter selbst
        // (`1080p` heißt auch im Hochformat 1080p).
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (abgebrochen) return;
          setQualities(
            hls.levels
              .map((level, index) => ({
                index,
                label: `${Math.min(level.width, level.height)}p`,
              }))
              .sort((links, rechts) => Number.parseInt(rechts.label) - Number.parseInt(links.label)),
          );
        });

        // Welche Stufe tatsächlich läuft – auch im Automatikbetrieb. Ohne die
        // Anzeige wüsste niemand, ob eine matschige Stelle am Material liegt
        // oder an einer stillen Herabstufung (Phase 22).
        hls.on(Hls.Events.LEVEL_SWITCHED, (_ereignis, daten) => {
          if (abgebrochen) return;
          const stufe = hls.levels[daten.level];
          setActiveLabel(stufe ? `${Math.min(stufe.width, stufe.height)}p` : null);
        });

        hls.loadSource(url);
        hls.attachMedia(video);
        setSource('hls');
      } catch {
        // Ohne hls.js bleibt es beim progressiven Proxy – kein Beinbruch.
        setSource('progressiv');
      }
    })();

    return () => {
      abgebrochen = true;
      instanz?.destroy();
      instanzRef.current = null;
    };
  }, [videoRef, version.id, hatLeiter, enabled]);

  /**
   * Stufe fest wählen (Phase 22). `currentLevel` statt `nextLevel`: Wer hier
   * bewusst 1080p wählt, will sie jetzt sehen, nicht erst nach dem Puffer –
   * der kurze Nachladeknick ist der Preis der ausdrücklichen Entscheidung.
   */
  const setLevel = useCallback((index: number) => {
    const instanz = instanzRef.current;
    if (!instanz) return;
    instanz.currentLevel = index;
    setSelectedLevel(index);
  }, []);

  return { source, qualities, selectedLevel, activeLabel, setLevel };
}
