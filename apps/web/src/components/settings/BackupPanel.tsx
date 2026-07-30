'use client';

import type { BackupFileDto, BackupSettingsDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { api } from '@/lib/api';
import { formatBytes, formatDateTime } from '@/lib/format';

/**
 * Einstellungen → Datensicherung (Phase 23).
 *
 * Gesichert wird die **Datenbank**, nicht die Mediendateien: Projekte,
 * Kommentare, Freigaben, Einstellungen. Die Videos liegen im selben Volume –
 * eine Kopie davon daneben wäre keine Sicherung.
 */
export function BackupPanel() {
  const [settings, setSettings] = useState<BackupSettingsDto | null>(null);
  const [dateien, setDateien] = useState<BackupFileDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wiederherstellen, setWiederherstellen] = useState<BackupFileDto | null>(null);

  const load = useCallback(async () => {
    try {
      const [geladen, liste] = await Promise.all([api.getBackupSettings(), api.listBackups()]);
      setSettings(geladen);
      setDateien(liste);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const speichere = async (input: Parameters<typeof api.updateBackupSettings>[0]) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      setSettings(await api.updateBackupSettings(input));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const jetztSichern = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const datei = await api.runBackup();
      setInfo(`Gesichert: ${datei.name} (${formatBytes(datei.sizeBytes)}).`);
      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Sichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const loesche = async (datei: BackupFileDto) => {
    if (!window.confirm(`Die Sicherung „${datei.name}" endgültig löschen?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteBackup(datei.name);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Löschen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return <div className="empty">{error ?? 'Wird geladen …'}</div>;
  }

  return (
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        Regelmäßige Sicherung der Datenbank – Projekte, Kommentare, Freigaben, Einstellungen.
      </p>

      {error ? <div className="notice">{error}</div> : null}
      {info ? (
        <div className="card" style={{ padding: '10px 12px', marginBottom: 14 }}>
          {info}
        </div>
      ) : null}

      {!settings.toolsAvailable ? (
        <div className="notice">
          <strong>In diesem Container fehlt <code>pg_dump</code>.</strong> Ohne das Werkzeug lässt
          sich nichts sichern. Es steckt im Paket <code>postgresql-client-16</code> und wird mit
          dem Image ausgeliefert – nach einem Update von Klappe müssen die Images einmal neu
          gebaut werden.
        </div>
      ) : null}

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px' }}>Automatisch sichern</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Die Dateien liegen unter <code>{settings.directory}</code> – einem Unterordner des
          Medienverzeichnisses. Der tägliche Aufräumer lässt sie in Ruhe.
        </p>

        <label className="switch" style={{ display: 'flex', marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy}
            onChange={(event) => void speichere({ enabled: event.target.checked })}
          />
          Datenbank regelmäßig sichern
        </label>

        <fieldset className="abschnitt" disabled={!settings.enabled}>
          <div className="grid-two">
            <div className="field">
              <label className="field__label" htmlFor="backup-interval">
                Abstand (Stunden)
              </label>
              <input
                id="backup-interval"
                className="input"
                type="number"
                min={1}
                max={336}
                value={settings.intervalHours}
                onChange={(event) =>
                  setSettings({ ...settings, intervalHours: Number(event.target.value) || 1 })
                }
                onBlur={(event) => void speichere({ intervalHours: Number(event.target.value) })}
              />
              <p className="hint">Vorgabe 24 Stunden.</p>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="backup-retention">
                Aufbewahren (Tage)
              </label>
              <input
                id="backup-retention"
                className="input"
                type="number"
                min={0}
                max={365}
                value={settings.retentionDays}
                onChange={(event) =>
                  setSettings({ ...settings, retentionDays: Number(event.target.value) || 0 })
                }
                onBlur={(event) => void speichere({ retentionDays: Number(event.target.value) })}
              />
              <p className="hint">
                Vorgabe 30 Tage. Ältere werden nach dem nächsten Lauf entfernt – die neueste
                bleibt immer stehen, auch wenn sie älter ist.
              </p>
            </div>
          </div>
        </fieldset>

        <div className="toolbar" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="button"
            disabled={busy || !settings.toolsAvailable}
            onClick={() => void jetztSichern()}
          >
            {busy ? 'Läuft …' : 'Jetzt sichern'}
          </button>
          <span className="faint" style={{ fontSize: 12 }}>
            {settings.lastRunAt
              ? `zuletzt ${formatDateTime(settings.lastRunAt)}`
              : 'noch nie gesichert'}
          </span>
        </div>

        {settings.lastError ? (
          <div className="notice" style={{ marginTop: 10 }}>
            <strong>Der letzte Lauf ist gescheitert:</strong> {settings.lastError}
          </div>
        ) : null}
      </div>

      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <h3 style={{ margin: '0 0 4px' }}>Vorhandene Sicherungen</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Wiederherstellen wirft den jetzigen Stand der Datenbank weg und ersetzt ihn. Vorher legt
          Klappe von selbst eine Sicherung des jetzigen Standes an – wer die falsche Datei
          erwischt, kommt so zurück.
        </p>

        {dateien.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            Noch keine Sicherung vorhanden.
          </p>
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Datei</th>
                  <th>Angelegt</th>
                  <th style={{ textAlign: 'right' }}>Größe</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {dateien.map((datei) => (
                  <tr key={datei.name}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {datei.name}
                    </td>
                    <td className="muted">{formatDateTime(datei.createdAt)}</td>
                    <td className="mono" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {formatBytes(datei.sizeBytes)}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={busy || !settings.toolsAvailable}
                        onClick={() => setWiederherstellen(datei)}
                      >
                        Wiederherstellen
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={busy}
                        onClick={() => void loesche(datei)}
                      >
                        Löschen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {wiederherstellen ? (
        <RestoreDialog
          datei={wiederherstellen}
          onClose={() => setWiederherstellen(null)}
          onDone={async (meldung) => {
            setWiederherstellen(null);
            setInfo(meldung);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

/** Das Wort, das getippt werden muss. Ein Haken wäre hier zu wenig. */
const BESTAETIGUNG = 'WIEDERHERSTELLEN';

function RestoreDialog({
  datei,
  onClose,
  onDone,
}: {
  datei: BackupFileDto;
  onClose: () => void;
  onDone: (meldung: string) => Promise<void>;
}) {
  const [wort, setWort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title="Datenbank wiederherstellen" onClose={onClose}>
      <div className="notice">
        <strong>Das ersetzt den gesamten jetzigen Stand der Datenbank.</strong> Alles, was seit
        dem {formatDateTime(datei.createdAt)} entstanden ist – Kommentare, Projekte, Freigaben,
        Einstellungen –, ist danach weg.
      </div>

      <p style={{ fontSize: 14 }}>
        Wiederhergestellt wird aus <code>{datei.name}</code> ({formatBytes(datei.sizeBytes)}).
      </p>

      <ul className="hint" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
        <li>
          Der jetzige Stand wird zuvor selbst gesichert – der Name steht danach hier, falls das
          hier ein Irrtum war.
        </li>
        <li>
          <strong>Die Mediendateien bleiben unberührt.</strong> Zeigt die alte Datenbank auf
          Fassungen, die inzwischen gelöscht wurden, fehlen deren Dateien.
        </li>
        <li>
          Danach den Stapel <strong>neu starten</strong>: Die laufenden Prozesse halten
          Verbindungen und Zwischenstände, die zur bisherigen Datenbank gehören.
        </li>
      </ul>

      {error ? <div className="notice">{error}</div> : null}

      <div className="field">
        <label className="field__label" htmlFor="restore-confirm">
          Zum Bestätigen <code>{BESTAETIGUNG}</code> eintippen
        </label>
        <input
          id="restore-confirm"
          className="input"
          autoFocus
          value={wort}
          onChange={(event) => setWort(event.target.value)}
        />
      </div>

      <div className="dialog__actions">
        <button type="button" className="button" onClick={onClose}>
          Abbrechen
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={busy || wort.trim() !== BESTAETIGUNG}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const ergebnis = await api.restoreBackup(datei.name);
              await onDone(
                `Wiederhergestellt aus „${datei.name}". Der Stand von vorher liegt als „${ergebnis.sicherungVorher}" bereit. Bitte den Stapel neu starten.`,
              );
            } catch (restoreError) {
              setError(
                restoreError instanceof Error
                  ? restoreError.message
                  : 'Wiederherstellen fehlgeschlagen.',
              );
              setBusy(false);
            }
          }}
        >
          {busy ? 'Läuft …' : 'Endgültig wiederherstellen'}
        </button>
      </div>
    </Dialog>
  );
}
