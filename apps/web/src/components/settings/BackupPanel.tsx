'use client';

import type { BackupFileDto, BackupSettingsDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { api } from '@/lib/api';
import { formatBytes, formatDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n';

/**
 * Einstellungen → Datensicherung (Phase 23).
 *
 * Gesichert wird die **Datenbank**, nicht die Mediendateien: Projekte,
 * Kommentare, Freigaben, Einstellungen. Die Videos liegen im selben Volume –
 * eine Kopie davon daneben wäre keine Sicherung.
 */
export function BackupPanel() {
  const t = useT();
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
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    }
  }, [t]);

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
      setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
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
      setInfo(t('backup.done', { name: datei.name, size: formatBytes(datei.sizeBytes) }));
      await load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : t('backup.runFailed'));
    } finally {
      setBusy(false);
    }
  };

  const loesche = async (datei: BackupFileDto) => {
    if (!window.confirm(t('backup.deleteConfirm', { name: datei.name }))) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteBackup(datei.name);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t('common.deleteFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return <div className="empty">{error ?? t('common.loading')}</div>;
  }

  return (
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        {t('backup.subtitle')}
      </p>

      {error ? <div className="notice">{error}</div> : null}
      {info ? (
        <div className="card" style={{ padding: '10px 12px' }}>
          {info}
        </div>
      ) : null}

      {!settings.toolsAvailable ? (
        <div className="notice">
          <strong>{t('backup.missingToolTitle', { tool: 'pg_dump' })}</strong>{' '}
          {t('backup.missingToolBody', { package: 'postgresql-client-16' })}
        </div>
      ) : null}

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px' }}>{t('backup.autoTitle')}</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {t('backup.directoryHint', { path: settings.directory })}
        </p>

        <label className="switch" style={{ display: 'flex', marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy}
            onChange={(event) => void speichere({ enabled: event.target.checked })}
          />
          {t('backup.enable')}
        </label>

        <fieldset className="abschnitt" disabled={!settings.enabled}>
          <div className="grid-two">
            <div className="field">
              <label className="field__label" htmlFor="backup-interval">
                {t('backup.intervalLabel')}
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
              <p className="hint">{t('backup.intervalHint')}</p>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="backup-retention">
                {t('backup.retentionLabel')}
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
                {t('backup.retentionHint')}
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
            {busy ? t('backup.running') : t('backup.runNow')}
          </button>
          <span className="faint" style={{ fontSize: 12 }}>
            {settings.lastRunAt
              ? t('backup.lastRun', { when: formatDateTime(settings.lastRunAt) })
              : t('backup.neverRun')}
          </span>
        </div>

        {settings.lastError ? (
          <div className="notice" style={{ marginTop: 10 }}>
            <strong>{t('backup.lastFailed')}</strong> {settings.lastError}
          </div>
        ) : null}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px' }}>{t('backup.existingTitle')}</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {t('backup.existingHint')}
        </p>

        {dateien.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            {t('backup.none')}
          </p>
        ) : (
          <div className="tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('backup.colFile')}</th>
                  <th>{t('backup.colCreated')}</th>
                  <th style={{ textAlign: 'right' }}>{t('backup.colSize')}</th>
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
                        {t('backup.restore')}
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        disabled={busy}
                        onClick={() => void loesche(datei)}
                      >
                        {t('common.delete')}
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

function RestoreDialog({
  datei,
  onClose,
  onDone,
}: {
  datei: BackupFileDto;
  onClose: () => void;
  onDone: (meldung: string) => Promise<void>;
}) {
  const t = useT();
  const bestaetigung = t('backup.confirmWord');
  const [wort, setWort] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title={t('backup.restoreTitle')} onClose={onClose}>
      <div className="notice">
        <strong>{t('backup.restoreWarnTitle')}</strong>{' '}
        {t('backup.restoreWarnBody', { date: formatDateTime(datei.createdAt) })}
      </div>

      <p style={{ fontSize: 14 }}>
        {t('backup.restoreFrom', {
          file: datei.name,
          size: formatBytes(datei.sizeBytes),
        })}
      </p>

      <ul className="hint" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
        <li>{t('backup.restoreBullet1')}</li>
        <li>
          <strong>{t('backup.restoreBullet2Bold')}</strong> {t('backup.restoreBullet2')}
        </li>
        <li>
          {t('backup.restoreBullet3Start')} <strong>{t('backup.restoreBullet3Bold')}</strong>
          {t('backup.restoreBullet3End')}
        </li>
      </ul>

      {error ? <div className="notice">{error}</div> : null}

      <div className="field">
        <label className="field__label" htmlFor="restore-confirm">
          {t('backup.confirmLabelStart')} <code>{bestaetigung}</code>{' '}
          {t('backup.confirmLabelEnd')}
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
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={busy || wort.trim() !== bestaetigung}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const ergebnis = await api.restoreBackup(datei.name);
              await onDone(
                t('backup.restoreDone', {
                  file: datei.name,
                  previous: ergebnis.sicherungVorher,
                }),
              );
            } catch (restoreError) {
              setError(
                restoreError instanceof Error ? restoreError.message : t('backup.restoreFailed'),
              );
              setBusy(false);
            }
          }}
        >
          {busy ? t('backup.running') : t('backup.restoreFinally')}
        </button>
      </div>
    </Dialog>
  );
}
