'use client';

import type { ProjectSettingsDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n';

/**
 * Einstellungen → Projekte (Phase 20).
 *
 * Bisher stand die Aufbewahrungsfrist archivierter Projekte auf der Seite
 * „E-Mail-Versand" – technisch dieselbe Zeile in der Datenbank, inhaltlich
 * ohne jeden Zusammenhang. Wer sie suchte, suchte lange.
 */
export function ProjectsPanel() {
  const t = useT();
  const [settings, setSettings] = useState<ProjectSettingsDto | null>(null);
  const [tage, setTage] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const geladen = await api.getProjectSettings();
      setSettings(geladen);
      setTage(geladen.archiveRetentionDays);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const gespeichert = await api.updateProjectSettings({ archiveRetentionDays: tage });
      setSettings(gespeichert);
      setTage(gespeichert.archiveRetentionDays);
      setInfo(t('common.saved'));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return <div className="empty">{error ?? t('common.loading')}</div>;
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        {t('projectsSettings.subtitle')}
      </p>

      {error ? <div className="notice">{error}</div> : null}
      {info ? (
        <div className="card" style={{ padding: '10px 12px' }}>
          {info}
        </div>
      ) : null}

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px' }}>{t('projectsSettings.archivedTitle')}</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {t('projectsSettings.archivedHint')}
        </p>

        <div className="field">
          <label className="field__label" htmlFor="archive-days">
            {t('projectsSettings.retentionLabel')}
          </label>
          <input
            id="archive-days"
            className="input"
            type="number"
            min={0}
            max={365}
            style={{ maxWidth: 160 }}
            value={tage}
            onChange={(event) => setTage(Number(event.target.value) || 0)}
          />
          <p className="hint">
            {t('projectsSettings.retentionHint')} <strong>0</strong>{' '}
            {t('projectsSettings.retentionZero')}
          </p>
        </div>

        <div className="toolbar" style={{ marginTop: 8 }}>
          <button type="submit" className="button" disabled={busy}>
            {t('common.save')}
          </button>
          <span className="faint" style={{ fontSize: 12 }}>
            {t('common.lastChanged', { when: formatDateTime(settings.updatedAt) })}
          </span>
        </div>
      </div>
    </form>
  );
}
