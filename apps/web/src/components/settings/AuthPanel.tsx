'use client';

import type { AuthSettingsDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/**
 * Anmeldewege (Phase 11).
 *
 * Die lokale Anmeldung lässt sich erst abschalten, wenn Microsoft 365 aktiv
 * und vollständig eingetragen ist – die API weist es sonst ab. Hier wird der
 * Schalter zusätzlich gesperrt, damit man gar nicht erst dagegen läuft.
 */
export function AuthPanel() {
  const [settings, setSettings] = useState<AuthSettingsDto | null>(null);
  const [form, setForm] = useState({
    localLoginEnabled: true,
    oidcEnabled: false,
    tenantId: '',
    clientId: '',
    clientSecret: '',
    autoProvision: false,
    allowedDomains: '',
    buttonLabel: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const current = await api.getAuthSettings();
      setSettings(current);
      setForm({
        localLoginEnabled: current.localLoginEnabled,
        oidcEnabled: current.oidcEnabled,
        tenantId: current.tenantId ?? '',
        clientId: current.clientId ?? '',
        clientSecret: '',
        autoProvision: current.autoProvision,
        allowedDomains: current.allowedDomains.join(', '),
        buttonLabel: current.buttonLabel,
      });
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
      const saved = await api.updateAuthSettings({
        localLoginEnabled: form.localLoginEnabled,
        oidcEnabled: form.oidcEnabled,
        tenantId: form.tenantId,
        clientId: form.clientId,
        // Leeres Feld heißt „unverändert“ – sonst würde ein Speichern das
        // hinterlegte Secret löschen, nur weil es nicht angezeigt wird.
        ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
        autoProvision: form.autoProvision,
        allowedDomains: form.allowedDomains,
        buttonLabel: form.buttonLabel,
      });
      setSettings(saved);
      setForm((current) => ({ ...current, clientSecret: '' }));
      setInfo('Gespeichert.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const copyRedirect = async () => {
    if (!settings) return;
    try {
      await navigator.clipboard.writeText(settings.redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  // Vollständig heißt: aktiv, Tenant, Client-ID und irgendein Secret.
  const oidcVollstaendig =
    form.oidcEnabled &&
    form.tenantId.trim().length > 0 &&
    form.clientId.trim().length > 0 &&
    (form.clientSecret.trim().length > 0 || Boolean(settings?.hasClientSecret));

  return (
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        Team-Konten melden sich lokal mit Passwort an, über Microsoft 365 – oder beides. Gäste
        kommen unabhängig davon immer über ihren Freigabe-Link mit E-Mail-Code herein.
      </p>

      {error ? <div className="notice">{error}</div> : null}
      {info ? (
        <div className="card" style={{ padding: '10px 12px', marginBottom: 14 }}>
          {info}
        </div>
      ) : null}

      <form
        className="card"
        style={{ padding: 20 }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="switch" style={{ marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={form.oidcEnabled}
            onChange={(event) => setForm({ ...form, oidcEnabled: event.target.checked })}
          />
          Anmeldung über Microsoft 365 anbieten
        </label>

        <label className="switch" style={{ marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={form.localLoginEnabled}
            disabled={!oidcVollstaendig}
            onChange={(event) => setForm({ ...form, localLoginEnabled: event.target.checked })}
          />
          Lokale Anmeldung mit Passwort erlauben
        </label>
        {!oidcVollstaendig ? (
          <p className="hint" style={{ marginTop: -10 }}>
            Abschaltbar, sobald Microsoft 365 aktiv und vollständig eingetragen ist – sonst käme
            niemand mehr herein.
          </p>
        ) : null}

        <div className="field">
          <span className="field__label">Redirect-URI für die App-Registrierung</span>
          <div className="share__url">
            <input
              className="input mono"
              readOnly
              value={settings?.redirectUri ?? ''}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" className="button" onClick={() => void copyRedirect()}>
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
          </div>
          <p className="hint">
            Im Entra Admin Center unter <em>App-Registrierungen → Authentifizierung</em> als
            Web-Plattform eintragen. Stimmt sie nicht, weist Microsoft die Anmeldung ab.
          </p>
        </div>

        <div className="grid-two">
          <div className="field">
            <label className="field__label" htmlFor="tenant">
              Verzeichnis-ID (Tenant)
            </label>
            <input
              id="tenant"
              className="input mono"
              placeholder="00000000-0000-0000-0000-000000000000"
              value={form.tenantId}
              onChange={(event) => setForm({ ...form, tenantId: event.target.value })}
            />
            <p className="hint">Auch die Domäne geht, etwa contoso.onmicrosoft.com.</p>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="client-id">
              Anwendungs-ID (Client)
            </label>
            <input
              id="client-id"
              className="input mono"
              value={form.clientId}
              onChange={(event) => setForm({ ...form, clientId: event.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="client-secret">
            Geheimer Clientschlüssel
          </label>
          <input
            id="client-secret"
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder={settings?.hasClientSecret ? '•••••••• (gespeichert)' : ''}
            value={form.clientSecret}
            onChange={(event) => setForm({ ...form, clientSecret: event.target.value })}
          />
          <p className="hint">
            Leer lassen behält den gespeicherten Schlüssel. Er liegt verschlüsselt in der Datenbank
            und wird nie wieder angezeigt. Denk an das Ablaufdatum, das Entra vergibt.
          </p>
        </div>

        <label className="switch" style={{ marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={form.autoProvision}
            onChange={(event) => setForm({ ...form, autoProvision: event.target.checked })}
          />
          Unbekannte Adressen automatisch als Team-Mitglied anlegen
        </label>
        <p className="hint" style={{ marginTop: -10 }}>
          Aus gutem Grund standardmäßig aus: In einem großen Tenant bekäme sonst jeder Beschäftigte
          Zugriff auf alle Projekte. Ohne diesen Schalter kommt nur herein, wer hier schon ein Konto
          hat.
        </p>

        <div className="field">
          <label className="field__label" htmlFor="domains">
            Erlaubte Domänen beim automatischen Anlegen
          </label>
          <input
            id="domains"
            className="input"
            placeholder="thd.de, beispiel.org"
            value={form.allowedDomains}
            onChange={(event) => setForm({ ...form, allowedDomains: event.target.value })}
          />
          <p className="hint">Leer heißt: keine Einschränkung.</p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="button-label">
            Beschriftung der Schaltfläche
          </label>
          <input
            id="button-label"
            className="input"
            value={form.buttonLabel}
            onChange={(event) => setForm({ ...form, buttonLabel: event.target.value })}
          />
        </div>

        <div className="toolbar" style={{ marginTop: 18 }}>
          {settings ? (
            <span className="faint" style={{ fontSize: 12 }}>
              zuletzt geändert {formatDateTime(settings.updatedAt)}
            </span>
          ) : null}
          <div className="shell__spacer" />
          <button type="submit" className="button button--primary" disabled={busy}>
            Speichern
          </button>
        </div>
      </form>

      <p className="hint" style={{ marginTop: 14 }}>
        Zum Ausprobieren: erst speichern, dann in einem privaten Fenster die Anmeldeseite öffnen.
        Schlägt es fehl, steht die Begründung von Microsoft dort im Klartext.
      </p>
    </>
  );
}
