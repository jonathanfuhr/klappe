'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Das eigene Konto.
 *
 * Wichtig vor allem für den Administrator: Sein Startpasswort steht im
 * Klartext in der `.env`, weil das Konto beim ersten Start daraus entsteht.
 * Solange es sich nicht ändern lässt, muss es dort stehen bleiben – und
 * jeder, der die Datei lesen kann, kommt herein. Nach dem ersten Wechsel
 * dürfen `ADMIN_PASSWORD` und `ADMIN_EMAIL` aus der `.env` verschwinden.
 */
export default function AccountPage() {
  const { user } = useSession();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const zuKurz = next.length > 0 && next.length < 10;
  const ungleich = repeat.length > 0 && next !== repeat;
  const kannSpeichern = current.length > 0 && next.length >= 10 && next === repeat && !busy;

  return (
    <AppShell>
      <div className="page" style={{ maxWidth: 560 }}>
        <div className="page__header">
          <div>
            <h1 className="page__title">Mein Konto</h1>
            <p className="muted" style={{ marginBottom: 0 }}>
              {user ? `${user.name} · ${user.email}` : '…'}
            </p>
          </div>
        </div>

        <form
          className="card"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            setDone(false);
            try {
              await api.changePassword(current, next);
              setCurrent('');
              setNext('');
              setRepeat('');
              setDone(true);
            } catch (changeError) {
              setError(
                changeError instanceof Error ? changeError.message : 'Ändern fehlgeschlagen.',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2 className="card__title">Passwort ändern</h2>

          {error ? <div className="notice">{error}</div> : null}
          {done ? (
            <div className="notice notice--ok">
              Das Passwort ist geändert. Steht es noch als <code>ADMIN_PASSWORD</code> in der
              <code>.env</code>, kann es dort jetzt raus.
            </div>
          ) : null}

          <div className="field">
            <label className="field__label" htmlFor="current-password">
              Bisheriges Passwort
            </label>
            <input
              id="current-password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="new-password">
              Neues Passwort
            </label>
            <input
              id="new-password"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
            <p className="hint">
              Mindestens 10 Zeichen, Buchstaben und Ziffern gemischt.
              {zuKurz ? ' Noch zu kurz.' : ''}
            </p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="repeat-password">
              Neues Passwort wiederholen
            </label>
            <input
              id="repeat-password"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
            />
            {ungleich ? <p className="hint">Die beiden Eingaben stimmen nicht überein.</p> : null}
          </div>

          <div className="dialog__actions">
            <button type="submit" className="button button--primary" disabled={!kannSpeichern}>
              {busy ? 'Wird geändert …' : 'Passwort ändern'}
            </button>
          </div>
        </form>

        {user?.role === 'ADMIN' ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Passwörter anderer Konten setzt du unter <Link href="/benutzer">Benutzer</Link>.
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
