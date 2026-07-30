'use client';

import type { ProjectSettingsDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/**
 * Einstellungen → Projekte (Phase 20).
 *
 * Bisher stand die Aufbewahrungsfrist archivierter Projekte auf der Seite
 * „E-Mail-Versand" – technisch dieselbe Zeile in der Datenbank, inhaltlich
 * ohne jeden Zusammenhang. Wer sie suchte, suchte lange.
 */
export function ProjectsPanel() {
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
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    }
  }, []);

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
      setInfo('Gespeichert.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return <div className="empty">{error ?? 'Wird geladen …'}</div>;
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        Wie Klappe mit Projekten umgeht, die aus dem Alltag heraus sind.
      </p>

      {error ? <div className="notice">{error}</div> : null}
      {info ? (
        <div className="card" style={{ padding: '10px 12px', marginBottom: 14 }}>
          {info}
        </div>
      ) : null}

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px' }}>Archivierte Projekte</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Wird ein Projekt archiviert, bleibt je Video nur die neueste fertige Fassung sichtbar,
          und kommentieren geht nicht mehr. Vorhandene Kommentare bleiben lesbar.
        </p>

        <div className="field">
          <label className="field__label" htmlFor="archive-days">
            Alte Fassungen aufbewahren (Tage)
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
            So lange bleiben die älteren Fassungen liegen – falls das Archivieren ein Irrtum war –
            und werden dann vom nächtlichen Aufräumer gelöscht, um Platz zu schaffen. Die neueste
            bleibt immer. <strong>0</strong> löscht sie beim nächsten Aufräumen.
          </p>
        </div>

        <div className="toolbar" style={{ marginTop: 8 }}>
          <button type="submit" className="button" disabled={busy}>
            Speichern
          </button>
          <span className="faint" style={{ fontSize: 12 }}>
            zuletzt geändert {formatDateTime(settings.updatedAt)}
          </span>
        </div>
      </div>
    </form>
  );
}
