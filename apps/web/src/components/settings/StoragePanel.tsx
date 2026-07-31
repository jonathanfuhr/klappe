'use client';

import type { StorageStatusDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';

/**
 * Einstellungen → Speicher (Phase 22).
 *
 * Die Frage, die hier beantwortet wird, ist die vor jedem großen Upload:
 * „Passt das noch drauf?" Deshalb steht der freie Platz oben und groß, und
 * die Aufschlüsselung darunter sagt, wo man ansetzen müsste, wenn nicht.
 *
 * Zwei Zahlen, die man leicht verwechselt: Der Balken zeigt das **ganze
 * Dateisystem** – auf einer NAS liegt darauf oft noch anderes –, die Liste
 * darunter nur, was **Klappe** selbst belegt.
 */

/** Ab hier wird es eng bzw. ernst. */
const WARNUNG_AB = 0.9;
const KRITISCH_AB = 0.95;

export function StoragePanel() {
  const [status, setStatus] = useState<StorageStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setStatus(await api.getStorageStatus());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!status) {
    return <div className="empty">{error ?? 'Wird geladen …'}</div>;
  }

  /**
   * Anteil wie bei `df`: belegt gemessen an dem, was für uns überhaupt
   * erreichbar ist. Die root-Reserve gehört in keinen der beiden Töpfe – sie
   * sonst mitzuzählen, machte eine volle Platte optisch halbleer.
   */
  const erreichbar =
    status.usedBytes !== null && status.freeBytes !== null
      ? status.usedBytes + status.freeBytes
      : null;
  const anteil =
    erreichbar && erreichbar > 0 && status.usedBytes !== null ? status.usedBytes / erreichbar : null;

  /** Wie viel des Belegten auf Klappe entfällt – der zweite Balkenabschnitt. */
  const klappeAnteil =
    erreichbar && erreichbar > 0 ? Math.min(status.usage.total / erreichbar, 1) : null;

  const posten: Array<[string, number, string]> = [
    ['Originale', status.usage.originals, 'Die hochgeladenen Dateien selbst – unangetastet.'],
    ['Abspielfassungen', status.usage.proxies, 'Was im Browser läuft (Proxy).'],
    ['Download-Formate', status.usage.renditions, 'Auf Vorrat oder auf Wunsch erzeugte Fassungen.'],
    ['Kundenmaterial', status.usage.projectFiles, 'Die Ablage je Projekt.'],
    ['Angefangene Uploads', status.usage.uploads, 'Übertragungen im Zwischenspeicher.'],
  ];

  return (
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        Wie voll das Dateisystem ist, auf dem die Mediendateien liegen.
      </p>

      {error ? <div className="notice">{error}</div> : null}

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px' }}>Freier Platz</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Gemessen am Dateisystem hinter <code>{status.path}</code>, so wie der API-Dienst es
          sieht.
          {status.passthroughFs ? null : (
            <> Liegt dort noch anderes, zählt es mit – der Balken zeigt die Platte, nicht Klappe allein.</>
          )}
        </p>

        {status.passthroughFs ? (
          /* Bewusst keine Zahl und kein Balken: Was das Betriebssystem hier
             meldet, beschreibt die virtuelle Maschine und nicht die Platte,
             auf der das Material liegt. Eine falsche Antwort auf „passt das
             noch drauf?" ist schlimmer als gar keine. */
          <div className="notice">
            <strong>Der freie Platz lässt sich von hier aus nicht ermitteln.</strong> Der
            Medienordner ist über <code>{status.passthroughFs}</code> aus einer virtuellen Maschine
            durchgereicht – so läuft es etwa bei Docker Desktop auf dem Mac. Die Größen, die das
            Betriebssystem dazu meldet, gehören der Zwischenschicht und nicht der echten Platte,
            deshalb steht hier lieber nichts als eine erfundene Zahl. Auf dem Rechner selbst sagt
            es <code>df -h</code> auf den Medienordner. Die Aufschlüsselung unten stimmt
            unabhängig davon.
          </div>
        ) : !status.available || anteil === null ? (
          <div className="notice">
            Das Betriebssystem gibt zu diesem Pfad keine Auskunft über den freien Platz. Die
            Aufschlüsselung unten stimmt trotzdem.
          </div>
        ) : (
          <>
            <div className="storagebar" role="img" aria-label={`${Math.round(anteil * 100)} % belegt`}>
              {/* Zwei Abschnitte übereinander: alles Belegte, davon Klappes
                  Anteil. So ist auf einen Blick zu sehen, ob eine volle
                  Platte überhaupt an Klappe liegt. */}
              <div
                className="storagebar__used"
                data-level={anteil >= KRITISCH_AB ? 'kritisch' : anteil >= WARNUNG_AB ? 'eng' : 'ok'}
                style={{ width: `${Math.min(anteil * 100, 100)}%` }}
              />
              {klappeAnteil !== null ? (
                <div className="storagebar__klappe" style={{ width: `${klappeAnteil * 100}%` }} />
              ) : null}
            </div>

            <div className="storagebar__legend">
              <strong style={{ fontSize: 18 }}>{formatBytes(status.freeBytes ?? 0)} frei</strong>
              <span className="muted">
                von {formatBytes(status.totalBytes ?? 0)} · {formatBytes(status.usedBytes ?? 0)}{' '}
                belegt ({Math.round(anteil * 100)} %)
              </span>
            </div>

            {anteil >= WARNUNG_AB ? (
              <div className={anteil >= KRITISCH_AB ? 'notice' : 'notice notice--warn'}>
                <strong>
                  {anteil >= KRITISCH_AB ? 'Der Platz geht zu Ende.' : 'Es wird eng.'}
                </strong>{' '}
                Läuft das Dateisystem voll, brechen Uploads mitten in der Übertragung ab und die
                Verarbeitung schlägt fehl. Platz schaffen: alte Projekte archivieren (die
                Aufbewahrungsfrist steht unter <em>Projekte</em>), nicht mehr gebrauchte Fassungen
                löschen oder die Platte vergrößern.
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px' }}>Davon Klappe</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Aus der Datenbank summiert. Posterframes, Sprite-Streifen und die HLS-Segmente führt
          Klappe ohne Größe – sie fehlen hier. Die Summe ist also eine Untergrenze, keine
          Messung des Ordners.
        </p>

        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>Posten</th>
                <th style={{ textAlign: 'right' }}>Größe</th>
              </tr>
            </thead>
            <tbody>
              {posten.map(([label, bytes, erklaerung]) => (
                <tr key={label}>
                  <td>
                    {label}
                    <span className="faint" style={{ display: 'block', fontSize: 12 }}>
                      {erklaerung}
                    </span>
                  </td>
                  <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {formatBytes(bytes)}
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <strong>Zusammen</strong>
                </td>
                <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <strong>{formatBytes(status.usage.total)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="toolbar" style={{ marginTop: 12 }}>
          <button type="button" className="button" disabled={busy} onClick={() => void load()}>
            {busy ? 'Wird geprüft …' : 'Neu prüfen'}
          </button>
        </div>
      </div>
    </>
  );
}
