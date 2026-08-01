'use client';

import type { ApiAccessSettingsDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { DeviceList } from '@/components/DeviceList';
import { api } from '@/lib/api';

/**
 * Einstellungen → API-Zugriff (Phase 27).
 *
 * Der Schalter, nach dem im Konzept ausdrücklich gefragt wurde: Wer Klappe
 * nur im Browser benutzt, soll die Tür nach außen zulassen können. Ab Werk
 * steht sie zu – eine zweite Zutrittsmöglichkeit, von der der Betreiber
 * nichts weiß, wäre keine gute Voreinstellung.
 */
export function ApiAccessPanel() {
  const [settings, setSettings] = useState<ApiAccessSettingsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await api.getApiAccess());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const umschalten = async (enabled: boolean) => {
    if (
      !enabled &&
      settings &&
      settings.activeTokens > 0 &&
      !window.confirm(
        `Externen Zugriff abschalten? ${settings.activeTokens} verbundene ${
          settings.activeTokens === 1 ? 'Gerät kommt' : 'Geräte kommen'
        } ab sofort nicht mehr herein.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      setSettings(await api.updateApiAccess(enabled));
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
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        Programme außerhalb des Browsers – Plugins für Schnittprogramme, eigene Skripte, später
        Desktop- und Telefon-Apps – erreichen Klappe über dieselbe Schnittstelle wie die Oberfläche.
        Verbunden wird jedes Gerät einzeln und mit einem Konto; eigene Zugangsdaten gibt es dafür
        nicht.
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
          Externen API-Zugriff erlauben
        </label>
        <p className="hint">
          Aus heißt: Es lässt sich kein Gerät mehr verbinden, und schon verbundene kommen nicht
          mehr herein – der Schalter wirkt sofort und für alle. Die Verbindungen bleiben dabei
          bestehen und gelten wieder, sobald der Schalter zurückgeht. Die Anmeldung im Browser ist
          davon nie betroffen.
        </p>

        {settings.enabled ? (
          <p className="hint" style={{ marginTop: 12 }}>
            Wie sich ein Gerät verbindet, steht in der{' '}
            <a href="/handbuch">Anleitung</a>; wer selbst etwas bauen will, findet die
            Schnittstelle in <code>docs/api.md</code>.
          </p>
        ) : null}

        <div style={{ marginTop: 18, borderTop: '1px solid var(--klappe-border)', paddingTop: 16 }}>
          <h2 className="section__title" style={{ marginBottom: 12 }}>
            Verbundene Geräte im Workspace
          </h2>
          <p className="hint">
            Alle Konten. Jeder trennt seine eigenen Geräte unter „Mein Konto" auch selbst – hier
            kommt der Betreiber an alle heran.
          </p>

          <DeviceList scope="all" />
        </div>
      </div>
    </>
  );
}
