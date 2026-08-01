'use client';

import type {
  MailFailureDto,
  SmtpAuthMethod,
  SmtpProviderPresetDto,
  SmtpSettingsDto,
} from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/**
 * SMTP-Einstellungen (Phase 8).
 *
 * Bewusst generisches SMTP: Die Anbieter-Vorlagen füllen nur Host, Port und
 * TLS vor. Dadurch lässt sich der Dienst wechseln, ohne dass am Code etwas
 * passiert.
 */
export function SmtpPanel() {
  const t = useT();
  const { formatDateTime } = useFormat();
  const { user } = useSession();

  const [settings, setSettings] = useState<SmtpSettingsDto | null>(null);
  const [presets, setPresets] = useState<SmtpProviderPresetDto[]>([]);
  const [form, setForm] = useState({
    enabled: false,
    provider: 'brevo',
    host: '',
    port: 587,
    secure: false,
    authMethod: 'password' as SmtpAuthMethod,
    user: '',
    password: '',
    oauthTenantId: '',
    oauthClientId: '',
    oauthClientSecret: '',
    fromName: 'Klappe',
    fromEmail: '',
    digestMinutes: 5,
  });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fehlversand, setFehlversand] = useState<MailFailureDto[]>([]);

  const load = useCallback(async () => {
    try {
      const [current, presetList, gescheitert] = await Promise.all([
        api.getSmtpSettings(),
        api.smtpPresets(),
        api.mailFailures().catch(() => []),
      ]);
      setSettings(current);
      setPresets(presetList);
      setFehlversand(gescheitert);
      setForm({
        enabled: current.enabled,
        provider: current.provider ?? 'brevo',
        host: current.host ?? '',
        port: current.port ?? 587,
        secure: current.secure,
        authMethod: current.authMethod,
        user: current.user ?? '',
        password: '',
        oauthTenantId: current.oauthTenantId ?? '',
        oauthClientId: current.oauthClientId ?? '',
        oauthClientSecret: '',
        fromName: current.fromName ?? 'Klappe',
        fromEmail: current.fromEmail ?? '',
        digestMinutes: current.digestMinutes,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    }
  }, [t]);

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
        authMethod: form.authMethod,
        user: form.user,
        // Leeres Feld heißt „unverändert“ – sonst würde ein Speichern das
        // hinterlegte Passwort bzw. Secret löschen, nur weil es nicht
        // angezeigt wird.
        ...(form.authMethod === 'password' && form.password ? { password: form.password } : {}),
        ...(form.authMethod === 'oauth2'
          ? {
              oauthTenantId: form.oauthTenantId,
              oauthClientId: form.oauthClientId,
              ...(form.oauthClientSecret ? { oauthClientSecret: form.oauthClientSecret } : {}),
            }
          : {}),
        fromName: form.fromName,
        fromEmail: form.fromEmail,
        digestMinutes: form.digestMinutes,
      });
      setSettings(saved);
      setForm((current) => ({ ...current, password: '', oauthClientSecret: '' }));
      setInfo(t('common.saved'));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
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
      setInfo(t('smtp.testSent', { email: user?.email ?? '' }));
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : t('smtp.testFailed'));
    } finally {
      setBusy(false);
    }
  };

  const preset = presets.find((entry) => entry.id === form.provider);

  return (
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        {t('smtp.subtitle')}
      </p>

      {error ? <div className="notice">{error}</div> : null}
      {info ? (
        <div className="card" style={{ padding: '10px 12px' }}>
          {info}
        </div>
      ) : null}

      {/* Ganz oben, nicht unten: Wer hier hereinkommt, weil eine Mail nicht
          ankam, soll es sofort sehen (Phase 18). */}
      {fehlversand.length > 0 ? (
        <div className="card" style={{ padding: 16 }}>
          <div className="toolbar" style={{ marginBottom: 10 }}>
            <strong>{t('smtp.undelivered')}</strong>
            <span className="badge badge--failed">{fehlversand.length}</span>
            <div className="shell__spacer" />
            <button
              type="button"
              className="button button--ghost"
              onClick={async () => {
                await api.clearMailFailures().catch(() => undefined);
                setFehlversand([]);
              }}
            >
              {t('smtp.clearList')}
            </button>
          </div>

          {fehlversand.map((eintrag) => (
            <div key={eintrag.id} className="guest">
              <div className="toolbar" style={{ gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{eintrag.recipient}</strong>
                {eintrag.attempts > 1 ? (
                  <span className="badge">{t('smtp.attempts', { count: eintrag.attempts })}</span>
                ) : null}
                <div className="shell__spacer" />
                <span className="faint" style={{ fontSize: 12 }}>
                  {formatDateTime(eintrag.lastAt)}
                </span>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={async () => {
                    await api.clearMailFailures(eintrag.id).catch(() => undefined);
                    setFehlversand((current) => current.filter((e) => e.id !== eintrag.id));
                  }}
                >
                  {t('smtp.acknowledge')}
                </button>
              </div>
              <span className="faint" style={{ fontSize: 12 }}>
                {eintrag.subject}
              </span>
              <div className="notice" style={{ marginTop: 6 }}>
                {eintrag.error}
              </div>
            </div>
          ))}

          <p className="hint" style={{ margin: '8px 0 0' }}>
            {t('smtp.failureHint')}
          </p>
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
          {t('smtp.enabled')}
        </label>

        <div className="field">
          <label className="field__label" htmlFor="provider">
            {t('smtp.providerPreset')}
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
              {t('smtp.host')}
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
              {t('smtp.port')}
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
          {t('smtp.secure')}
        </label>

        <div className="field">
          <label className="field__label" htmlFor="auth-method">
            {t('smtp.authMethod')}
          </label>
          <select
            id="auth-method"
            className="select"
            value={form.authMethod}
            onChange={(event) =>
              setForm({ ...form, authMethod: event.target.value as SmtpAuthMethod })
            }
          >
            <option value="password">{t('smtp.authPassword')}</option>
            <option value="oauth2">{t('smtp.authOauth')}</option>
          </select>
          {form.authMethod === 'oauth2' ? (
            <p className="hint">
              {t('smtp.oauthHintStart')} <strong>SMTP.SendAsApp</strong>{' '}
              {t('smtp.oauthHintMiddle')} <strong>New-ApplicationAccessPolicy</strong>
              {t('smtp.oauthHintEnd')}
            </p>
          ) : null}
        </div>

        {form.authMethod === 'oauth2' ? (
          <>
            <div className="grid-two">
              <div className="field">
                <label className="field__label" htmlFor="oauth-tenant">
                  {t('auth.tenant')}
                </label>
                <input
                  id="oauth-tenant"
                  className="input"
                  autoComplete="off"
                  value={form.oauthTenantId}
                  onChange={(event) => setForm({ ...form, oauthTenantId: event.target.value })}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor="oauth-client">
                  {t('auth.clientId')}
                </label>
                <input
                  id="oauth-client"
                  className="input"
                  autoComplete="off"
                  value={form.oauthClientId}
                  onChange={(event) => setForm({ ...form, oauthClientId: event.target.value })}
                />
              </div>
            </div>
            <div className="grid-two">
              <div className="field">
                <label className="field__label" htmlFor="smtp-user">
                  {t('smtp.sendingMailbox')}
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
                <label className="field__label" htmlFor="oauth-secret">
                  {t('smtp.clientSecret')}
                </label>
                <input
                  id="oauth-secret"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  placeholder={settings?.hasOauthClientSecret ? t('auth.clientSecretStored') : ''}
                  value={form.oauthClientSecret}
                  onChange={(event) => setForm({ ...form, oauthClientSecret: event.target.value })}
                />
                <p className="hint">{t('smtp.secretKeepHint')}</p>
              </div>
            </div>
          </>
        ) : (
          <div className="grid-two">
            <div className="field">
              <label className="field__label" htmlFor="smtp-user">
                {t('smtp.username')}
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
                {t('common.password')}
              </label>
              <input
                id="smtp-password"
                className="input"
                type="password"
                autoComplete="new-password"
                placeholder={settings?.hasPassword ? t('auth.clientSecretStored') : ''}
                value={form.password}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
              <p className="hint">{t('smtp.passwordKeepHint')}</p>
            </div>
          </div>
        )}

        <div className="grid-two">
          <div className="field">
            <label className="field__label" htmlFor="from-name">
              {t('smtp.fromName')}
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
              {t('smtp.fromEmail')}
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
          {t('smtp.spfHint')}
        </p>

        <div className="section">
          <div className="section__head">
            <h2 className="section__title">{t('smtp.digestTitle')}</h2>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="digest-minutes">
              {t('smtp.digestLabel')}
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
              {t('smtp.digestHintStart')} <strong>0</strong> {t('smtp.digestHintEnd')}
            </p>
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 18 }}>
          {settings ? (
            <span className="faint" style={{ fontSize: 12 }}>
              {t('common.lastChanged', { when: formatDateTime(settings.updatedAt) })}
            </span>
          ) : null}
          <div className="shell__spacer" />
          <button
            type="button"
            className="button"
            disabled={busy || !settings?.enabled}
            onClick={() => void sendTest()}
            title={settings?.enabled ? undefined : t('smtp.sendTestDisabled')}
          >
            {t('smtp.sendTest')}
          </button>
          <button type="submit" className="button button--primary" disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </>
  );
}
