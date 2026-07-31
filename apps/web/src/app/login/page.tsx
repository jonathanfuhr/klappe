'use client';

import type { LoginMethodsDto } from '@klappe/shared';
import { DEFAULT_PASSWORD_POLICY } from '@klappe/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { API_BASE, api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Anmeldung (Phase 0, um den Gastzugang erweitert in Phase 20).
 *
 * Zwei Wege auf einer Seite: das Team mit Passwort oder Microsoft 365, der
 * Kunde mit seiner Adresse und einem Code. Letzteres gab es bisher nur über
 * den Freigabe-Link – wer den nicht mehr fand, stand vor einer Anmeldung, für
 * die er kein Passwort hat.
 */
function LoginForm() {
  const searchParams = useSearchParams();
  const [modus, setModus] = useState<'team' | 'gast'>('team');

  const target = searchParams.get('weiter') ?? '/projekte';

  return modus === 'team' ? (
    <TeamLogin target={target} aufGast={() => setModus('gast')} />
  ) : (
    <GastLogin zurueck={() => setModus('team')} />
  );
}

function TeamLogin({ target, aufGast }: { target: string; aufGast: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Ein gescheiterter M365-Versuch kommt als Weiterleitung mit Begründung
  // zurück – die soll man lesen können, statt auf einer leeren Seite zu sitzen.
  const [error, setError] = useState<string | null>(searchParams.get('fehler'));
  const [busy, setBusy] = useState(false);
  const [methods, setMethods] = useState<LoginMethodsDto>({
    local: true,
    microsoft: false,
    microsoftLabel: 'Mit Microsoft 365 anmelden',
    passwordPolicy: DEFAULT_PASSWORD_POLICY,
  });

  useEffect(() => {
    void api
      .loginMethods()
      .then(setMethods)
      // Ohne Antwort bleibt die lokale Anmeldung stehen – besser eine
      // Möglichkeit zu viel als eine Seite ohne jede.
      .catch(() => undefined);
  }, []);

  return (
    <form
      className="card login__card"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.login(email, password);
          // Das Passwort hat gestimmt – trotzdem kann die Sitzung fehlen, wenn
          // der Browser das Cookie verworfen hat (`Secure` über http://). Ohne
          // diese Prüfung landet man wortlos wieder auf dieser Seite.
          if (!(await refresh())) {
            setError(
              'Passwort richtig, aber der Browser hat das Sitzungs-Cookie verworfen. ' +
                'Das passiert, wenn SESSION_COOKIE_SECURE=1 gesetzt ist, die Seite aber ' +
                'über http:// statt https:// aufgerufen wird.',
            );
            return;
          }
          // `replace`, damit der Zurück-Knopf nicht wieder aufs Login führt.
          router.replace(target.startsWith('/') ? target : '/projekte');
        } catch (loginError) {
          setError(loginError instanceof Error ? loginError.message : 'Anmeldung fehlgeschlagen.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <BrandMark />
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
        Review und Freigabe für Videoproduktionen
      </p>

      {error ? <div className="notice">{error}</div> : null}

      {methods.microsoft ? (
        <a
          className="button button--primary"
          style={{ width: '100%', justifyContent: 'center', marginBottom: 4 }}
          // Bewusst ein echter Link und kein fetch: Die Anmeldung bei
          // Microsoft ist eine Reise durch mehrere Seiten, die der Browser
          // selbst antreten muss.
          href={`${API_BASE}/v1/auth/microsoft/start?redirect=${encodeURIComponent(
            target.startsWith('/') ? target : '/projekte',
          )}`}
        >
          {methods.microsoftLabel}
        </a>
      ) : null}

      {methods.microsoft && methods.local ? <div className="login__or">oder</div> : null}

      {methods.local ? (
        <>
          <div className="field">
            <label className="field__label" htmlFor="email">
              E-Mail-Adresse
            </label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="password">
              Passwort
            </label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <button
            type="submit"
            className={methods.microsoft ? 'button' : 'button button--primary'}
            style={{ width: '100%', marginTop: 12 }}
            disabled={busy}
          >
            {busy ? 'Wird angemeldet …' : 'Anmelden'}
          </button>
        </>
      ) : (
        <p className="hint" style={{ textAlign: 'center' }}>
          Für Team-Konten ist in diesem Workspace nur die Anmeldung über Microsoft 365 vorgesehen.
        </p>
      )}

      <div className="login__or">oder</div>
      <button
        type="button"
        className="button button--ghost"
        style={{ width: '100%' }}
        onClick={aufGast}
      >
        Gastzugang
      </button>
      <p className="hint" style={{ textAlign: 'center', marginBottom: 0 }}>
        Für Kunden, die schon eine Freigabe haben – ohne Passwort, mit einem Code per Mail.
      </p>
    </form>
  );
}

/**
 * Der Gastzugang. Kein neues Konto entsteht hier: Wer nicht schon
 * freigeschaltet ist, bekommt eine Absage im Browser und **keine** Mail –
 * sonst könnte sich jeder eintragen und Post von dieser Anlage bekommen.
 */
function GastLogin({ zurueck }: { zurueck: () => void }) {
  const router = useRouter();
  const { refresh } = useSession();

  const [schritt, setSchritt] = useState<'mail' | 'code'>('mail');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const codeAnfordern = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.requestGuestLoginCode(email);
      setSchritt('code');
      setInfo(`Wir haben einen Code an ${email} geschickt. Er gilt 15 Minuten.`);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Der Code ließ sich nicht verschicken.',
      );
    } finally {
      setBusy(false);
    }
  };

  const anmelden = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.verifyGuestLogin({ email, code });
      if (!(await refresh())) {
        setError(
          'Der Code stimmt, aber der Browser hat das Sitzungs-Cookie verworfen. ' +
            'Das passiert, wenn SESSION_COOKIE_SECURE=1 gesetzt ist, die Seite aber ' +
            'über http:// statt https:// aufgerufen wird.',
        );
        return;
      }
      router.replace(result.redirectPath);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Der Code stimmt nicht.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card login__card"
      onSubmit={(event) => {
        event.preventDefault();
        void (schritt === 'mail' ? codeAnfordern() : anmelden());
      }}
    >
      <BrandMark />
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
        Gastzugang – für Kunden mit einer Freigabe
      </p>

      {info ? (
        <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
          {info}
        </p>
      ) : null}
      {error ? <div className="notice">{error}</div> : null}

      {schritt === 'mail' ? (
        <div className="field">
          <label className="field__label" htmlFor="gast-login-email">
            E-Mail-Adresse
          </label>
          <input
            id="gast-login-email"
            className="input"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <p className="hint">
            Dieselbe Adresse, an die die Freigabe ging. Ein neues Konto entsteht hier nicht.
          </p>
        </div>
      ) : (
        <div className="field">
          <label className="field__label" htmlFor="gast-login-code">
            Code aus der E-Mail
          </label>
          <input
            id="gast-login-code"
            className="input gate__code"
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </div>
      )}

      <button
        type="submit"
        className="button button--primary"
        style={{ width: '100%', marginTop: 12 }}
        disabled={busy || (schritt === 'code' && code.length !== 6)}
      >
        {busy
          ? schritt === 'mail'
            ? 'Code wird geschickt …'
            : 'Wird geprüft …'
          : schritt === 'mail'
            ? 'Code anfordern'
            : 'Anmelden'}
      </button>

      <button
        type="button"
        className="button button--ghost"
        style={{ width: '100%', marginTop: 8 }}
        onClick={() => {
          if (schritt === 'code') {
            setSchritt('mail');
            setCode('');
            setError(null);
            setInfo(null);
            return;
          }
          zurueck();
        }}
      >
        Zurück
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="login">
      <Suspense fallback={<div className="card login__card">Wird geladen …</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
