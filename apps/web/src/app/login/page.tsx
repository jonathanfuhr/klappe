'use client';

import type { LoginMethodsDto } from '@klappe/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { API_BASE, api } from '@/lib/api';
import { useSession } from '@/lib/session';

function LoginForm() {
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
  });

  const target = searchParams.get('weiter') ?? '/projekte';

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
