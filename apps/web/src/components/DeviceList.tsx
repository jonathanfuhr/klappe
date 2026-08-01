'use client';

import type { ApiTokenDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useT } from '@/lib/i18n';

/**
 * Die Liste der verbundenen Geräte (Phase 27).
 *
 * Dieselbe Darstellung an zwei Stellen, mit einem einzigen Unterschied:
 *
 * - `scope="mine"` unter „Mein Konto" – jeder sieht seine eigenen Geräte und
 *   trennt sie selbst. Wer seinen Laptop verliert, soll nicht erst einen
 *   Administrator suchen müssen.
 * - `scope="all"` in den Einstellungen – der Administrator sieht alle Geräte
 *   des Workspace samt Konto und kann jedes trennen.
 *
 * Getrennte Geräte bleiben stehen, ausgegraut. Eine Liste, aus der Einträge
 * einfach verschwinden, beantwortet die Frage „habe ich das eben wirklich
 * getrennt?" nicht.
 */
export function DeviceList({ scope }: { scope: 'mine' | 'all' }) {
  const t = useT();
  const [devices, setDevices] = useState<ApiTokenDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDevices(scope === 'all' ? await api.listAllDevices() : await api.listDevices());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    }
  }, [scope, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const trennen = async (device: ApiTokenDto) => {
    // Zwei Sätze statt eines mit eingeschobenem „von X": Im Englischen steht
    // die Person an anderer Stelle, das ließe sich nicht zusammenstückeln.
    const frage =
      scope === 'all' && device.user
        ? t('devices.revokeConfirmOther', { name: device.name, user: device.user.name })
        : t('devices.revokeConfirm', { name: device.name });
    if (!window.confirm(frage)) return;

    setBusy(true);
    setError(null);
    try {
      if (scope === 'all') await api.revokeAnyDevice(device.id);
      else await api.revokeDevice(device.id);
      await load();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : t('devices.revokeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const alleTrennen = async () => {
    if (!window.confirm(t('devices.revokeAllConfirm'))) return;

    setBusy(true);
    setError(null);
    try {
      await api.revokeAllDevices();
      await load();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : t('devices.revokeFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!devices) {
    return <div className="empty">{error ?? t('common.loading')}</div>;
  }

  const aktiv = devices.filter((device) => !device.revokedAt);

  return (
    <>
      {error ? <div className="notice">{error}</div> : null}

      {devices.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          {scope === 'all' ? t('devices.noneWorkspace') : t('devices.noneMine')}
        </p>
      ) : (
        <div className="list">
          {devices.map((device) => (
            <div
              className="tagrow"
              key={device.id}
              style={device.revokedAt ? { opacity: 0.55 } : undefined}
            >
              <div className="tagrow__name" style={{ display: 'grid', gap: 2 }}>
                <strong>{device.name}</strong>
                <span className="faint" style={{ fontSize: 12 }}>
                  {scope === 'all' && device.user ? `${device.user.name} · ` : ''}
                  <code>{device.masked}</code>
                  {device.origin === 'manual' ? ` · ${t('devices.manual')}` : ''}
                </span>
              </div>

              <div className="tagrow__rest">
                <span className="faint tagrow__count" title={formatDateTime(device.createdAt)}>
                  {device.revokedAt
                    ? t('devices.revokedAt', { when: formatRelative(device.revokedAt) })
                    : device.lastUsedAt
                      ? t('devices.lastUsed', { when: formatRelative(device.lastUsedAt) })
                      : t('devices.neverUsed')}
                </span>

                {device.revokedAt ? null : (
                  <button
                    type="button"
                    className="button button--ghost"
                    disabled={busy}
                    onClick={() => void trennen(device)}
                  >
                    {t('devices.revoke')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {scope === 'mine' && aktiv.length > 1 ? (
        <div className="dialog__actions" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="button button--ghost"
            disabled={busy}
            onClick={() => void alleTrennen()}
          >
            {t('devices.revokeAll')}
          </button>
        </div>
      ) : null}
    </>
  );
}
