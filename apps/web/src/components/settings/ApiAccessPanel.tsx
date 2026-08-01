'use client';

import type { ApiAccessSettingsDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { DeviceList } from '@/components/DeviceList';
import { api } from '@/lib/api';
import { Trans, useT } from '@/lib/i18n';

/**
 * Einstellungen → API-Zugriff (Phase 27).
 *
 * Der Schalter, nach dem im Konzept ausdrücklich gefragt wurde: Wer Klappe
 * nur im Browser benutzt, soll die Tür nach außen zulassen können. Ab Werk
 * steht sie zu – eine zweite Zutrittsmöglichkeit, von der der Betreiber
 * nichts weiß, wäre keine gute Voreinstellung.
 */
export function ApiAccessPanel() {
  const t = useT();
  const [settings, setSettings] = useState<ApiAccessSettingsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await api.getApiAccess());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const umschalten = async (enabled: boolean) => {
    if (
      !enabled &&
      settings &&
      settings.activeTokens > 0 &&
      !window.confirm(t('apiAccess.disableConfirm', { count: settings.activeTokens }))
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      setSettings(await api.updateApiAccess(enabled));
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
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        {t('apiAccess.intro')}
      </p>

      {error ? <div className="notice">{error}</div> : null}

      <div className="card" style={{ padding: 20 }}>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy}
            onChange={(event) => void umschalten(event.target.checked)}
          />
          {t('apiAccess.enable')}
        </label>
        <p className="hint">{t('apiAccess.enableHint')}</p>

        {settings.enabled ? (
          <p className="hint" style={{ marginTop: 12 }}>
            <Trans
              k="apiAccess.docsHint"
              parts={{
                link: <a href="/handbuch">{t('apiAccess.docsLink')}</a>,
                file: <code>docs/api.md</code>,
              }}
            />
          </p>
        ) : null}

        <div style={{ marginTop: 18, borderTop: '1px solid var(--klappe-border)', paddingTop: 16 }}>
          <h2 className="section__title" style={{ marginBottom: 12 }}>
            {t('apiAccess.workspaceDevices')}
          </h2>
          <p className="hint">{t('apiAccess.workspaceDevicesHint')}</p>

          <DeviceList scope="all" />
        </div>
      </div>
    </>
  );
}
