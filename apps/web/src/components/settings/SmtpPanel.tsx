'use client';

import type { SmtpProviderPresetDto, SmtpSettingsDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';

/**
 * SMTP-Einstellungen (Phase 8).
 *
 * Bewusst generisches SMTP: Die Anbieter-Vorlagen füllen nur Host, Port und
 * TLS vor. Dadurch lässt sich der Dienst wechseln, ohne dass am Code etwas
 * passiert.
 */
export function SmtpPanel() {
  const { user } = useSession();

  const [settings, setSettings] = useState<SmtpSettingsDto | null>(null);
  const [presets, setPresets] = useState<SmtpProviderPresetDto[]>([]);
  const [form, setForm] = useState({
    enabled: false,
    provider: 'brevo',
    host: '',
    port: 587,
    secure: false,
    user: '',
    password: '',
    fromName: 'Klappe',
    fromEmail: '',
    digestMinutes: 5,
    archiveRetentionDays: 30,
  });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [current, presetList] = await Promise.all([api.getSmtpSettings(), api.smtpPresets()]);
      setSettings(current);
      setPresets(presetList);
      setForm({
        enabled: current.enabled,
        provider: current.provider ?? 'brevo',
        host: current.host ?? '',
        port: current.port ?? 587,
        secure: current.secure,
        user: current.user ?? '',
        password: '',
        fromName: current.fromName ?? 'Klappe',
        fromEmail: current.fromEmail ?? '',
        digestMinutes: current.digestMinutes,
        archiveRetentionDays: current.archiveRetentionDays,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const applyPreset = (id: string) => {
    const preset = presets.find((entry) => entry.id === id);
    setForm((current) => ({
      ...current,
      provider: id,
      host: preset && preset.host ? preset.host : current.host,
      port: preset ? preset.port : current.port,
      secure: preset ? preset.secure : current.secure,
    }));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const saved = await api.updateSmtpSettings({
        enabled: form.enabled,
        provider: form.provider,
        host: form.host,
        port: form.port,
        secure: form.secure,
        user: form.user,
        // Leeres Feld heißt „unverändert“ – sonst würde ein Speichern das
        // hinterlegte Passwort löschen, nur weil es nicht angezeigt wird.
        ...(form.password ? { password: form.password } : {}),
        fromName: form.fromName,
        fromEmail: form.fromEmail,
        digestMinutes: form.digestMinutes,
        archiveRetentionDays: form.archiveRetentionDays,
      });
      setSettings(saved);
      setForm((current) => ({ ...current, password: '' }));
      setInfo('Gespeichert.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await api.sendTestMail();
      setInfo(`Testmail an ${user?.email} verschickt.`);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'Der Versand hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  };

  const preset = presets.find((entry) => entry.id === form.provider);

  return (
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        Nötig für Anmeldecodes der Gäste und für Benachrichtigungen zu Kommentaren, Erwähnungen und
        Kunden-Uploads.
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
        <label className="switch" style={{ marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
          />
          Versand aktiv
        </label>

        <div className="field">
          <label className="field__label" htmlFor="provider">
            Anbieter-Vorlage
          </label>
          <select
            id="provider"
            className="select"
            value={form.provider}
            onChange={(event) => applyPreset(event.target.value)}
          >
            {presets.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          {preset ? <p className="hint">{preset.hint}</p> : null}
        </div>

        <div className="grid-two">
          <div className="field">
            <label className="field__label" htmlFor="host">
              Server
            </label>
            <input
              id="host"
              className="input"
              value={form.host}
              onChange={(event) => setForm({ ...form, host: event.target.value })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="port">
              Port
            </label>
            <input
              id="port"
              className="input"
              type="number"
              min={1}
              max={65535}
              value={form.port}
              onChange={(event) => setForm({ ...form, port: Number(event.target.value) })}
            />
          </div>
        </div>

        <label className="switch" style={{ marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={form.secure}
            onChange={(event) => setForm({ ...form, secure: event.target.checked })}
          />
          Implizites TLS (Port 465). Bei 587 aus lassen – dort greift STARTTLS.
        </label>

        <div className="grid-two">
          <div className="field">
            <label className="field__label" htmlFor="smtp-user">
              Benutzername
            </label>
            <input
              id="smtp-user"
              className="input"
              autoComplete="off"
              value={form.user}
              onChange={(event) => setForm({ ...form, user: event.target.value })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="smtp-password">
              Passwort
            </label>
            <input
              id="smtp-password"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder={settings?.hasPassword ? '•••••••• (gespeichert)' : ''}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
            <p className="hint">Leer lassen behält das gespeicherte Passwort.</p>
          </div>
        </div>

        <div className="grid-two">
          <div className="field">
            <label className="field__label" htmlFor="from-name">
              Absender-Name
            </label>
            <input
              id="from-name"
              className="input"
              value={form.fromName}
              onChange={(event) => setForm({ ...form, fromName: event.target.value })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="from-email">
              Absender-Adresse
            </label>
            <input
              id="from-email"
              className="input"
              type="email"
              value={form.fromEmail}
              onChange={(event) => setForm({ ...form, fromEmail: event.target.value })}
            />
          </div>
        </div>

        <p className="hint">
          Damit Codes und Benachrichtigungen nicht im Spam landen, sollte die Absender-Domain SPF und
          DKIM gesetzt haben.
        </p>

        <div className="section">
          <div className="section__head">
            <h2 className="section__title">Sammelmails</h2>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="digest-minutes">
              Ruhezeit in Minuten
            </label>
            <input
              id="digest-minutes"
              className="input"
              type="number"
              min={0}
              max={120}
              style={{ maxWidth: 160 }}
              value={form.digestMinutes}
              onChange={(event) =>
                setForm({ ...form, digestMinutes: Number(event.target.value) || 0 })
              }
            />
            <p className="hint">
              Wer ein Video durchsieht, hinterlässt selten nur eine Anmerkung. Statt jede sofort zu
              verschicken, wartet Klappe, bis so viele Minuten lang kein neuer Kommentar mehr kam,
              und schickt dann eine Mail mit allen – je Empfänger und Video.{' '}
              <strong>0</strong> verschickt sofort, also eine Mail je Kommentar. Erwähnungen
              stehen auch in der Sammelmail im Betreff.
            </p>
          </div>
        </div>

        <div className="section">
          <div className="section__head">
            <h2 className="section__title">Archivierte Projekte</h2>
          </div>
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
              value={form.archiveRetentionDays}
              onChange={(event) =>
                setForm({ ...form, archiveRetentionDays: Number(event.target.value) || 0 })
              }
            />
            <p className="hint">
              Wird ein Projekt archiviert, bleibt je Video nur die neueste Fassung sichtbar und
              kommentieren ist aus. Die älteren Fassungen bleiben so viele Tage liegen – falls das
              Archivieren ein Irrtum war – und werden dann gelöscht, um Platz zu schaffen.{' '}
              <strong>0</strong> löscht sie beim nächsten nächtlichen Aufräumen.
            </p>
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 18 }}>
          {settings ? (
            <span className="faint" style={{ fontSize: 12 }}>
              zuletzt geändert {formatDateTime(settings.updatedAt)}
            </span>
          ) : null}
          <div className="shell__spacer" />
          <button
            type="button"
            className="button"
            disabled={busy || !settings?.enabled}
            onClick={() => void sendTest()}
            title={settings?.enabled ? undefined : 'Erst speichern und aktivieren'}
          >
            Testmail senden
          </button>
          <button type="submit" className="button button--primary" disabled={busy}>
            Speichern
          </button>
        </div>
      </form>
    </>
  );
}
