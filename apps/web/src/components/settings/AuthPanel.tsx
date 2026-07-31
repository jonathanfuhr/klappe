'use client';

import type { AuthSettingsDto } from '@klappe/shared';
import {
  DEFAULT_PASSWORD_POLICY,
  PASSWORD_MIN_LENGTH_CEILING,
  PASSWORD_MIN_LENGTH_FLOOR,
  describePasswordPolicy,
} from '@klappe/shared';
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
    // Passwort-Richtlinie (Phase 24)
    passwordMinLength: DEFAULT_PASSWORD_POLICY.minLength,
    passwordRequireLetter: DEFAULT_PASSWORD_POLICY.requireLetter,
    passwordRequireDigit: DEFAULT_PASSWORD_POLICY.requireDigit,
    passwordRequireMixedCase: DEFAULT_PASSWORD_POLICY.requireMixedCase,
    passwordRequireSymbol: DEFAULT_PASSWORD_POLICY.requireSymbol,
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
        passwordMinLength: current.passwordPolicy.minLength,
        passwordRequireLetter: current.passwordPolicy.requireLetter,
        passwordRequireDigit: current.passwordPolicy.requireDigit,
        passwordRequireMixedCase: current.passwordPolicy.requireMixedCase,
        passwordRequireSymbol: current.passwordPolicy.requireSymbol,
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
        passwordMinLength: form.passwordMinLength,
        passwordRequireLetter: form.passwordRequireLetter,
        passwordRequireDigit: form.passwordRequireDigit,
        passwordRequireMixedCase: form.passwordRequireMixedCase,
        passwordRequireSymbol: form.passwordRequireSymbol,
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
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {/* ---------- Erste Sektion: Passwort (Phase 24) ---------- */}
        <div className="card" style={{ padding: 20 }}>
          <h2 className="section__title" style={{ marginBottom: 12 }}>
            Passwort
          </h2>

          <label className="switch">
            <input
              type="checkbox"
              checked={form.localLoginEnabled}
              disabled={!oidcVollstaendig}
              onChange={(event) => setForm({ ...form, localLoginEnabled: event.target.checked })}
            />
            Anmeldung mit E-Mail und Passwort erlauben
          </label>
          {!oidcVollstaendig ? (
            <p className="hint">
              Abschaltbar, sobald Microsoft 365 aktiv und vollständig eingetragen ist – sonst käme
              niemand mehr herein.
            </p>
          ) : null}

          {/*
           * Die Richtlinie stand bis Phase 24 fest im Code. Sie gilt für neue
           * Konten und für jede Passwortänderung; bestehende Passwörter werden
           * nicht rückwirkend geprüft – das ließe sich gar nicht feststellen,
           * weil nur der Hash gespeichert ist.
           */}
          <div className="field" style={{ marginTop: 18 }}>
            <label className="field__label" htmlFor="pw-min-length">
              Mindestlänge
            </label>
            <input
              id="pw-min-length"
              className="input"
              type="number"
              style={{ width: 120 }}
              min={PASSWORD_MIN_LENGTH_FLOOR}
              max={PASSWORD_MIN_LENGTH_CEILING}
              value={form.passwordMinLength}
              onChange={(event) =>
                setForm({ ...form, passwordMinLength: Number(event.target.value) })
              }
            />
            <p className="hint">
              Zwischen {PASSWORD_MIN_LENGTH_FLOOR} und {PASSWORD_MIN_LENGTH_CEILING} Zeichen. Länge
              bringt mehr als Sonderzeichen – eine lange Wortfolge ist sicherer und leichter zu
              merken als „P4ssw!rt".
            </p>
          </div>

          <div className="field">
            <span className="field__label">Zusammensetzung</span>
            <label className="switch">
              <input
                type="checkbox"
                checked={form.passwordRequireLetter}
                onChange={(event) =>
                  setForm({ ...form, passwordRequireLetter: event.target.checked })
                }
              />
              Mindestens ein Buchstabe
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={form.passwordRequireDigit}
                onChange={(event) =>
                  setForm({ ...form, passwordRequireDigit: event.target.checked })
                }
              />
              Mindestens eine Ziffer
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={form.passwordRequireMixedCase}
                onChange={(event) =>
                  setForm({ ...form, passwordRequireMixedCase: event.target.checked })
                }
              />
              Groß- und Kleinbuchstaben
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={form.passwordRequireSymbol}
                onChange={(event) =>
                  setForm({ ...form, passwordRequireSymbol: event.target.checked })
                }
              />
              Mindestens ein Sonderzeichen
            </label>
            <p className="hint">
              Gilt für Team-Konten beim Anlegen und bei jeder Änderung. Bestehende Passwörter
              bleiben gültig – gespeichert ist nur ihr Hash, nachprüfen ließe sich das gar nicht.
              Gäste haben kein Passwort und sind nicht betroffen.
            </p>
            <p className="hint" style={{ marginTop: 4 }}>
              <strong>Es gilt dann:</strong>{' '}
              {describePasswordPolicy({
                minLength: form.passwordMinLength,
                requireLetter: form.passwordRequireLetter,
                requireDigit: form.passwordRequireDigit,
                requireMixedCase: form.passwordRequireMixedCase,
                requireSymbol: form.passwordRequireSymbol,
              }).join(', ')}
              .
            </p>
          </div>
        </div>

        {/* ---------- Zweite Sektion: Microsoft 365 ---------- */}
        <div className="card" style={{ padding: 20, marginTop: 16 }}>
          <h2 className="section__title" style={{ marginBottom: 12 }}>
            Microsoft 365
          </h2>

          <label className="switch">
            <input
              type="checkbox"
              checked={form.oidcEnabled}
              onChange={(event) => setForm({ ...form, oidcEnabled: event.target.checked })}
            />
            Anmeldung über Microsoft 365 anbieten
          </label>

          {/*
           * Die Einrichtungsfelder erscheinen erst mit dem Haken (Phase 24).
           * Vorher standen Tenant, Client-ID, Secret, Domänenliste und
           * Beschriftung auch dann da, wenn Microsoft 365 gar nicht benutzt
           * wird – acht Felder, die niemanden etwas angingen.
           */}
          {!form.oidcEnabled ? (
            <p className="hint" style={{ marginBottom: 0 }}>
              Aus. Zum Einrichten den Haken setzen – dann erscheinen die Felder für die
              App-Registrierung im Entra Admin Center.
            </p>
          ) : (
            <>
              <div className="field" style={{ marginTop: 16 }}>
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
            placeholder="firma.de, beispiel.org"
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
            </>
          )}
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
