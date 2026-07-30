'use client';

import type { VersionDto } from '@klappe/shared';
import { type RefObject, useEffect, useState } from 'react';
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

export function useHlsSource(
  videoRef: RefObject<HTMLVideoElement | null>,
  version: VersionDto,
  enabled: boolean,
): PlaybackSource {
  const [source, setSource] = useState<PlaybackSource>('progressiv');
  const hatLeiter = version.hlsVariants.length > 0;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !enabled || !hatLeiter) {
      setSource('progressiv');
      return;
    }

    const url = mediaUrl.hls(version.id);

    // Safari und iOS: HLS geht direkt ans <video>, ganz ohne Bibliothek.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      setSource('hls');
      return;
    }

    let abgebrochen = false;
    let instanz: { destroy: () => void } | null = null;

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
    };
  }, [videoRef, version.id, hatLeiter, enabled]);

  return source;
}
