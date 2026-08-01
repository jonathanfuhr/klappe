'use client';

import type { StorageStatusDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useT } from '@/lib/i18n';

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
  const t = useT();
  const [status, setStatus] = useState<StorageStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setStatus(await api.getStorageStatus());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!status) {
    return <div className="empty">{error ?? t('common.loading')}</div>;
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
    [t('storage.originals'), status.usage.originals, t('storage.originalsHint')],
    [t('storage.proxies'), status.usage.proxies, t('storage.proxiesHint')],
    [t('storage.renditions'), status.usage.renditions, t('storage.renditionsHint')],
    [t('storage.projectFiles'), status.usage.projectFiles, t('storage.projectFilesHint')],
    [t('storage.uploads'), status.usage.uploads, t('storage.uploadsHint')],
  ];

  return (
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        {t('storage.subtitle')}
      </p>

      {error ? <div className="notice">{error}</div> : null}

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px' }}>{t('storage.freeTitle')}</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {t('storage.measuredAt', { path: status.path })}
          {status.passthroughFs ? null : <>{t('storage.sharedHint')}</>}
        </p>

        {status.passthroughFs ? (
          /* Bewusst keine Zahl und kein Balken: Was das Betriebssystem hier
             meldet, beschreibt die virtuelle Maschine und nicht die Platte,
             auf der das Material liegt. Eine falsche Antwort auf „passt das
             noch drauf?" ist schlimmer als gar keine. */
          <div className="notice">
            <strong>{t('storage.passthroughTitle')}</strong>{' '}
            {t('storage.passthroughBody', { fs: status.passthroughFs, cmd: 'df -h' })}
          </div>
        ) : !status.available || anteil === null ? (
          <div className="notice">
            {t('storage.noInfo')}
          </div>
        ) : (
          <>
            <div className="storagebar" role="img" aria-label={t('storage.barLabel', { percent: Math.round(anteil * 100) })}>
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
              <strong style={{ fontSize: 18 }}>
                {t('storage.free', { size: formatBytes(status.freeBytes ?? 0) })}
              </strong>
              <span className="muted">
                {t('storage.ofUsed', {
                  total: formatBytes(status.totalBytes ?? 0),
                  used: formatBytes(status.usedBytes ?? 0),
                  percent: Math.round(anteil * 100),
                })}
              </span>
            </div>

            {anteil >= WARNUNG_AB ? (
              <div className={anteil >= KRITISCH_AB ? 'notice' : 'notice notice--warn'}>
                <strong>
                  {anteil >= KRITISCH_AB ? t('storage.criticalTitle') : t('storage.tightTitle')}
                </strong>{' '}
                {t('storage.warnBodyStart')} <em>{t('settings.navProjects')}</em>
                {t('storage.warnBodyEnd')}
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px' }}>{t('storage.klappeTitle')}</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {t('storage.klappeHint')}
        </p>

        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('storage.colItem')}</th>
                <th style={{ textAlign: 'right' }}>{t('storage.colSize')}</th>
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
                  <strong>{t('storage.total')}</strong>
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
            {busy ? t('storage.checking') : t('storage.recheck')}
          </button>
        </div>
      </div>
    </>
  );
}
