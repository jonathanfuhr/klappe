'use client';

import type { ProjectSettingsDto, VersionSettingsDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useT } from '@/lib/i18n';

/**
 * Einstellungen → Projekte (Phase 20).
 *
 * Bisher stand die Aufbewahrungsfrist archivierter Projekte auf der Seite
 * „E-Mail-Versand" – technisch dieselbe Zeile in der Datenbank, inhaltlich
 * ohne jeden Zusammenhang. Wer sie suchte, suchte lange.
 *
 * Seit Phase 28 stehen hier auch die zwei Schalter für **interne Fassungen**:
 * Sie sagen etwas über den Umgang mit Fassungen, nicht über den Mailversand –
 * bei den Benachrichtigungen waren sie nur einquartiert.
 */
export function ProjectsPanel() {
  const t = useT();
  const { formatDateTime } = useFormat();
  const [settings, setSettings] = useState<ProjectSettingsDto | null>(null);
  const [fassungen, setFassungen] = useState<VersionSettingsDto | null>(null);
  const [tage, setTage] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [geladen, versionen] = await Promise.all([
        api.getProjectSettings(),
        api.getVersionSettings(),
      ]);
      setSettings(geladen);
      setFassungen(versionen);
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

  /** Die beiden Fassungs-Schalter wirken sofort, ohne Speichern-Knopf. */
  const schalte = async (input: { internalEnabled?: boolean; internalByDefault?: boolean }) => {
    setBusy(true);
    setError(null);
    try {
      setFassungen(await api.updateVersionSettings(input));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

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

      {/*
        * Interne Fassungen (Phase 28). Anders als die Frist darüber wirken
        * diese beiden sofort – deshalb kein Speichern-Knopf, sondern
        * Schalter, die für sich stehen.
        */}
      {fassungen ? (
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 4px' }}>{t('projectsSettings.internalTitle')}</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            {t('projectsSettings.internalIntro')}
          </p>

          <label className="switch">
            <input
              type="checkbox"
              checked={fassungen.internalEnabled}
              disabled={busy}
              onChange={(event) =>
                void schalte({ internalEnabled: event.target.checked })
              }
            />
            {t('projectsSettings.internalEnabled')}
          </label>
          <p className="hint">{t('projectsSettings.internalEnabledHint')}</p>

          <label className="switch">
            <input
              type="checkbox"
              checked={fassungen.internalByDefault}
              // Ohne die Funktion ist die Vorgabe gegenstandslos – dann stünde
              // der Haken da und wirkte nirgends.
              disabled={busy || !fassungen.internalEnabled}
              onChange={(event) =>
                void schalte({ internalByDefault: event.target.checked })
              }
            />
            {t('projectsSettings.internalDefault')}
          </label>
          <p className="hint">{t('projectsSettings.internalDefaultHint')}</p>
        </div>
      ) : null}
    </form>
  );
}
