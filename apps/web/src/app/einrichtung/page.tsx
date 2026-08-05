'use client';

import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicy,
  describePasswordPolicy,
} from '@klappe/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/**
 * Ersteinrichtung (1.5.1).
 *
 * Wer Klappe zum ersten Mal öffnet, legt hier sein Admin-Konto an – vorher
 * standen dafür `ADMIN_EMAIL` und `ADMIN_PASSWORD` in der `.env`. Ein
 * Passwort in einer Datei bleibt dort stehen: im Klartext, in jeder
 * Sicherung, und in aller Regel unverändert.
 *
 * Die Seite ist nur erreichbar, solange es **kein einziges Konto** gibt. Sonst
 * schickt sie zur Anmeldung – die Prüfung steht zusätzlich im Server, hier
 * geht es nur darum, niemandem ein Formular zu zeigen, das ohnehin abgewiesen
 * würde.
 */
export default function SetupPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const t = useT();

  const [pruefung, setPruefung] = useState<'laeuft' | 'offen' | 'fertig'>('laeuft');
  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_PASSWORD_POLICY);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [wiederholung, setWiederholung] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .loginMethods()
      .then((methods) => {
        setPolicy(methods.passwordPolicy);
        setPruefung(methods.needsSetup ? 'offen' : 'fertig');
      })
      // Ohne Antwort keine Einrichtung anbieten: Im Zweifel steht die Anlage
      // schon, und ein zweites Admin-Formular wäre das falsche Angebot.
      .catch(() => setPruefung('fertig'));
  }, []);

  useEffect(() => {
    if (pruefung === 'fertig') router.replace('/login');
  }, [pruefung, router]);

  const absenden = async () => {
    if (password !== wiederholung) {
      setError(t('setup.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setup({ email, name, password });
      // Direkt anmelden: Wer das Konto gerade angelegt hat, soll nicht die
      // Daten ein zweites Mal eintippen.
      await api.login(email, password);
      await refresh();
      router.replace('/projekte');
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : t('common.saveFailed'));
      setBusy(false);
    }
  };

  if (pruefung !== 'offen') {
    return <div className="empty">{t('common.loading')}</div>;
  }

  return (
    <div className="loginpage">
      <form
        className="card loginpage__card"
        onSubmit={(event) => {
          event.preventDefault();
          void absenden();
        }}
      >
        <BrandMark />
        <h1 className="loginpage__title">{t('setup.title')}</h1>
        <p className="hint" style={{ marginTop: 0 }}>
          {t('setup.intro')}
        </p>

        {error ? <div className="notice notice--warn">{error}</div> : null}

        <div className="field">
          <label className="field__label" htmlFor="setup-name">
            {t('setup.name')}
          </label>
          <input
            id="setup-name"
            className="input"
            autoComplete="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="setup-email">
            {t('common.email')}
          </label>
          <input
            id="setup-email"
            className="input"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="setup-password">
            {t('common.password')}
          </label>
          <input
            id="setup-password"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {/* Die Regeln stehen **vor** dem Absenden da – eine Ablehnung
              hinterher ist die schlechtere Auskunft. */}
          <p className="hint">
            {describePasswordPolicy(policy)
              .map((regel) => t(regel.key, regel.vars))
              .join(', ')}
            .
          </p>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="setup-password2">
            {t('setup.passwordRepeat')}
          </label>
          <input
            id="setup-password2"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={wiederholung}
            onChange={(event) => setWiederholung(event.target.value)}
          />
        </div>

        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? t('setup.working') : t('setup.submit')}
        </button>
      </form>
    </div>
  );
}
