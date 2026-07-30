'use client';

import type { EmbedDto } from '@klappe/shared';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api';

/**
 * Der eingebettete Player.
 *
 * Absichtlich karg: keine Navigation, keine Kommentare, keine Anmeldung. Diese
 * Seite steht in einem `iframe` auf einer fremden Seite, und dort kann sie
 * keine Sitzung mitbringen – Browser blockieren Cookies von Drittanbietern.
 * Alles, was sie braucht, steckt im Token in der Adresse.
 *
 * Deshalb auch die schlichten Bedienelemente des Browsers statt des großen
 * Review-Players: Frame-Genauigkeit und Tastenkürzel gehören in die
 * Freigabeansicht, nicht in ein Fenster von 400 Pixeln Breite auf einer
 * fremden Seite.
 */
export default function EmbedPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [daten, setDaten] = useState<EmbedDto | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /**
   * `warten` heißt: Für diese Fassung gibt es eine Leiter, und der Versuch
   * läuft noch. Solange bleibt `src` leer – sonst lüde der Browser erst den
   * Proxy an und gleich darauf die Leiter.
   */
  const [quelle, setQuelle] = useState<'warten' | 'hls' | 'proxy'>('warten');

  useEffect(() => {
    let abgebrochen = false;
    void fetch(`${API_BASE}/v1/embed/${encodeURIComponent(token)}`)
      .then(async (antwort) => {
        if (!antwort.ok) throw new Error('Diese Einbettung gibt es nicht (mehr).');
        return (await antwort.json()) as EmbedDto;
      })
      .then((wert) => {
        if (!abgebrochen) setDaten(wert);
      })
      .catch((ladefehler: unknown) => {
        if (!abgebrochen) {
          setFehler(ladefehler instanceof Error ? ladefehler.message : 'Nicht verfügbar.');
        }
      });
    return () => {
      abgebrochen = true;
    };
  }, [token]);

  /**
   * Adaptive Wiedergabe auch im eingebetteten Player (Phase 23).
   *
   * Auf einer fremden Seite sitzt oft genau die schwache Leitung, für die die
   * Leiter gedacht ist. Safari kann HLS von Haus aus, Chrome und Firefox über
   * `hls.js` – das wird erst geladen, wenn es wirklich gebraucht wird.
   * Scheitert irgendetwas davon, bleibt es beim progressiven Proxy.
   */
  useEffect(() => {
    const video = videoRef.current;
    if (!daten) return;
    if (!video || !daten.hasHls) {
      setQuelle('proxy');
      return;
    }

    const url = `${API_BASE}/v1/embed/${encodeURIComponent(token)}/versions/${daten.versionId}/hls/index.m3u8`;

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      setQuelle('hls');
      return;
    }

    let abgebrochen = false;
    let instanz: { destroy: () => void } | null = null;

    void (async () => {
      try {
        const { default: Hls } = await import('hls.js');
        if (abgebrochen) return;
        if (!Hls.isSupported()) {
          setQuelle('proxy');
          return;
        }
        const hls = new Hls();
        instanz = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        setQuelle('hls');
      } catch {
        // Ohne hls.js bleibt es beim progressiven Proxy – kein Beinbruch.
        setQuelle('proxy');
      }
    })();

    return () => {
      abgebrochen = true;
      instanz?.destroy();
    };
  }, [daten?.hasHls, daten?.versionId, token]);

  if (fehler) {
    return (
      <div className="embed embed--leer">
        <p>{fehler}</p>
      </div>
    );
  }

  if (!daten) {
    return (
      <div className="embed embed--leer">
        <p>Wird geladen …</p>
      </div>
    );
  }

  const basis = `${API_BASE}/v1/embed/${encodeURIComponent(token)}/versions/${daten.versionId}`;

  return (
    <div className="embed">
      {/* Ohne `controls` gäbe es hier keine Bedienung – wir bringen keine
          eigene mit, damit der Player auch in einem schmalen Rahmen brauchbar
          bleibt. */}
      <video
        ref={videoRef}
        className="embed__video"
        // Bei HLS setzt der Haken unten die Quelle selbst; hier bleibt sie
        // dann leer, sonst lüde der Browser beides.
        src={quelle === 'proxy' ? `${basis}/proxy` : undefined}
        poster={daten.hasPoster ? `${basis}/poster` : undefined}
        controls
        playsInline
        preload="metadata"
      />
      <div className="embed__bar">
        <span className="embed__title" title={daten.title}>
          {daten.title}
        </span>
        <span className="embed__version">{daten.versionLabel}</span>
        {/* Auch hier, wo sonst nichts steht: Wer eine Zwischenfassung
            eingebettet sieht, soll sie nicht für das Ergebnis halten. */}
        {!daten.isFinal ? <span className="embed__version">Vorschau</span> : null}
        <span className="embed__spacer" />
        <span className="embed__brand">{daten.brandTitle}</span>
      </div>
    </div>
  );
}
