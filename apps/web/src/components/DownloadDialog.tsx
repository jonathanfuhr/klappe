'use client';

import type { VersionDownloadsDto, VersionRenditionDto } from '@klappe/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { api, mediaUrl } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useLiveTopic } from '@/lib/live';

/**
 * Wie oft nachgesehen wird, solange etwas erzeugt wird. Die Live-Verbindung
 * meldet jede Änderung ohnehin – dieser Takt ist das Netz darunter, falls ein
 * Proxy den Ereignisstrom kappt.
 */
const TAKT_MS = 3_000;

/**
 * Download-Fenster einer Fassung (Phase 19).
 *
 * Das Original steht immer oben und geht sofort los. Darunter die Formate,
 * die der Admin angelegt hat: Ist eines schon erzeugt, ist es genauso schnell
 * da; sonst wird es beim Klick erzeugt und der Balken zeigt, wie weit es ist.
 */
export function DownloadDialog({
  versionId,
  videoId,
  initial,
  onClose,
}: {
  versionId: string;
  videoId: string;
  /** Was der Knopf schon geholt hat – erspart eine zweite Abfrage beim Öffnen. */
  initial: VersionDownloadsDto;
  onClose: () => void;
}) {
  const [daten, setDaten] = useState<VersionDownloadsDto | null>(initial);
  const [error, setError] = useState<string | null>(null);
  /** Formate, deren Datei nach dem Fertigwerden gleich geholt werden soll. */
  const wartetAuf = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      setDaten(await api.listDownloads(versionId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    }
  }, [versionId]);

  // Anfang und Ende einer Erzeugung kommen über den Ereignisstrom …
  useLiveTopic('video', videoId, () => void load());

  // … der Fortschritt dazwischen nicht: Ein Ereignis je Prozentschritt wäre
  // für alle offenen Seiten ein Trommelfeuer. Solange etwas läuft, wird
  // deshalb im Takt nachgesehen; ist nichts unterwegs, ruht er.
  const laeuft = (daten?.renditions ?? []).some(
    (format) => format.status === 'QUEUED' || format.status === 'PROCESSING',
  );
  useEffect(() => {
    if (!laeuft) return undefined;
    const timer = window.setInterval(() => void load(), TAKT_MS);
    return () => window.clearInterval(timer);
  }, [laeuft, load]);

  const hole = useCallback(
    (presetId: string) => {
      // Ein unsichtbarer Link statt `window.open`: Den lässt der Popup-Blocker
      // durch, und der Dateiname kommt aus dem Content-Disposition der Antwort.
      const link = document.createElement('a');
      link.href = mediaUrl.rendition(versionId, presetId);
      link.download = '';
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    [versionId],
  );

  // Wer auf ein Format gewartet hat, bekommt es, sobald es da ist.
  useEffect(() => {
    for (const format of daten?.renditions ?? []) {
      if (format.status === 'READY' && wartetAuf.current.has(format.presetId)) {
        wartetAuf.current.delete(format.presetId);
        hole(format.presetId);
      }
      if (format.status === 'FAILED') wartetAuf.current.delete(format.presetId);
    }
  }, [daten, hole]);

  const fordereAn = async (format: VersionRenditionDto) => {
    setError(null);
    if (format.status === 'READY') {
      hole(format.presetId);
      return;
    }
    wartetAuf.current.add(format.presetId);
    try {
      await api.requestDownload(versionId, format.presetId);
      await load();
    } catch (requestError) {
      wartetAuf.current.delete(format.presetId);
      setError(requestError instanceof Error ? requestError.message : 'Anfordern fehlgeschlagen.');
    }
  };

  return (
    <Dialog title="Herunterladen" onClose={onClose}>
      {error ? <div className="notice">{error}</div> : null}

      {!daten ? (
        <p className="faint">Wird geladen …</p>
      ) : !daten.canDownload ? (
        <p className="faint">Für diese Fassung ist kein Download freigegeben.</p>
      ) : (
        <>
          {/* Vor dem Klick, nicht danach: Einer heruntergeladenen Datei sieht
              niemand mehr an, dass sie ein Zwischenstand war – im Zweifel
              liegt sie eine Woche später beim Kunden auf dem Schnittplatz
              (Phase 23). */}
          {!daten.isFinal ? (
            <div className="notice notice--warn">
              <strong>Noch keine Endfassung.</strong> Was hier das Haus verlässt, ist ein
              Zwischenstand zur Abstimmung – Farbe, Ton und Schnitt können sich noch ändern. Der
              Dateiname trägt deshalb <code>Vorschau</code> mit.
            </div>
          ) : null}

          <div className="downloadrow">
            <div className="downloadrow__text">
              <strong>Original</strong>
              <span className="faint" style={{ fontSize: 12 }}>
                {daten.originalFilename} · {formatBytes(daten.originalSizeBytes)}
              </span>
            </div>
            <a
              className="button"
              href={mediaUrl.original(versionId)}
              download
              onClick={() => onClose()}
            >
              Laden
            </a>
          </div>

          {daten.formatsEnabled && daten.renditions.length > 0 ? (
            <>
              <p className="hint" style={{ margin: '14px 0 6px' }}>
                Kleinere Fassungen. Was noch nicht erzeugt ist, entsteht beim Klick.
              </p>

              {daten.renditions.map((format) => (
                <div key={format.presetId} className="downloadrow">
                  <div className="downloadrow__text">
                    <strong>{format.name}</strong>
                    <span className="faint" style={{ fontSize: 12 }}>
                      {format.width && format.height
                        ? `${format.width}×${format.height}`
                        : `kurze Kante ${format.shortEdge} px`}
                      {format.sizeBytes ? ` · ${formatBytes(format.sizeBytes)}` : ''}
                      {` · .${format.container}`}
                    </span>

                    {format.status === 'QUEUED' ? (
                      <span className="faint" style={{ fontSize: 12 }}>
                        Wartet auf einen freien Platz …
                      </span>
                    ) : null}
                    {format.status === 'PROCESSING' ? (
                      <div className="progress" style={{ marginTop: 6 }}>
                        <div className="progress__bar" style={{ width: `${format.progress}%` }} />
                      </div>
                    ) : null}
                    {format.status === 'FAILED' ? (
                      <span className="badge badge--failed">{format.error ?? 'Fehlgeschlagen'}</span>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className={format.status === 'READY' ? 'button' : 'button button--ghost'}
                    disabled={format.status === 'QUEUED' || format.status === 'PROCESSING'}
                    onClick={() => void fordereAn(format)}
                  >
                    {format.status === 'READY'
                      ? 'Laden'
                      : format.status === 'PROCESSING'
                        ? `${format.progress} %`
                        : format.status === 'QUEUED'
                          ? 'In der Warteschlange'
                          : format.status === 'FAILED'
                            ? 'Noch einmal'
                            : 'Erzeugen'}
                  </button>
                </div>
              ))}

              <p className="hint" style={{ marginBottom: 0 }}>
                Der Download startet von selbst, sobald die gewählte Fassung fertig ist – das
                Fenster darf so lange offen bleiben.
              </p>
            </>
          ) : null}
        </>
      )}

      <div className="toolbar" style={{ marginTop: 16 }}>
        <div className="shell__spacer" />
        <button type="button" className="button button--ghost" onClick={onClose}>
          Schließen
        </button>
      </div>
    </Dialog>
  );
}
