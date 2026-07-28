'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const target = searchParams.get('weiter') ?? '/projekte';

  return (
    <form
      className="card login__card"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.login(email, password);
          await refresh();
          // `replace`, damit der Zurück-Knopf nicht wieder aufs Login führt.
          router.replace(target.startsWith('/') ? target : '/projekte');
        } catch (loginError) {
          setError(loginError instanceof Error ? loginError.message : 'Anmeldung fehlgeschlagen.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="login__brand">
        <span className="shell__brand-mark" aria-hidden>
          ◗
        </span>
        Klappe
      </div>
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
        Review und Freigabe für Videoproduktionen
      </p>

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

      {error ? <div className="notice">{error}</div> : null}

      <button
        type="submit"
        className="button button--primary"
        style={{ width: '100%', marginTop: 12 }}
        disabled={busy}
      >
        {busy ? 'Wird angemeldet …' : 'Anmelden'}
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
