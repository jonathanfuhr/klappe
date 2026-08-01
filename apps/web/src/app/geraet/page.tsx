'use client';

import type { DevicePendingDto } from '@klappe/shared';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Ein Gerät mit dem eigenen Konto verbinden (Phase 27).
 *
 * Hierher schickt ein Plugin seinen Benutzer: „Öffne klappe.example.de/geraet
 * und gib KHFP-3RTM ein.“ Wer dem Link folgt, ist meist schon angemeldet –
 * dann steht nur noch eine Frage im Weg. Wer es nicht ist, landet über den
 * gewohnten Weg auf der Anmeldeseite und kommt zurück.
 *
 * Das ist der Grund, warum die Kopplung so herum läuft: Im Browser gilt die
 * bestehende Anmeldung, ganz gleich ob sie mit Passwort oder über Microsoft
 * 365 zustande kam. Ein Anmeldeformular im Plugin könnte das nie – und müsste
 * ein Passwort entgegennehmen, das dort nichts zu suchen hat.
 */
export default function DevicePairingPage() {
  return (
    // `useSearchParams` verlangt eine Grenze, hinter der Next.js beim Bauen
    // aufhören darf, die Seite vorzurechnen.
    <Suspense fallback={null}>
      <DevicePairing />
    </Suspense>
  );
}

function DevicePairing() {
  const params = useSearchParams();
  const { user, loading } = useSession();

  const [code, setCode] = useState('');
  const [pending, setPending] = useState<DevicePendingDto | null>(null);
  const [status, setStatus] = useState<'eingabe' | 'frage' | 'verbunden' | 'abgelehnt'>('eingabe');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nachschlagen = useCallback(async (eingabe: string) => {
    setBusy(true);
    setError(null);
    try {
      const gefunden = await api.describeDevicePairing(eingabe);
      setPending(gefunden);
      setCode(gefunden.userCode);
      setStatus('frage');
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : 'Der Code stimmt nicht.');
      setStatus('eingabe');
    } finally {
      setBusy(false);
    }
  }, []);

  /*
   * Ein Code in der Adresse wird sofort nachgeschlagen – aber erst, wenn die
   * Sitzung feststeht. Ohne diese Bedingung liefe die Abfrage vor der
   * Anmeldung ins Leere und der Mensch sähe eine Fehlermeldung, die nur ein
   * Wettlauf war.
   */
  useEffect(() => {
    const ausAdresse = params.get('code');
    if (!ausAdresse || loading || !user || status !== 'eingabe' || busy) return;
    void nachschlagen(ausAdresse);
    // `busy` bewusst nicht in den Abhängigkeiten: Es wechselt während des
    // Nachschlagens und würde den Aufruf sonst ein zweites Mal auslösen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, loading, user, status, nachschlagen]);

  const bestaetigen = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await api.approveDevicePairing(pending.userCode);
      setStatus('verbunden');
    } catch (approveError) {
      setError(
        approveError instanceof Error ? approveError.message : 'Verbinden fehlgeschlagen.',
      );
    } finally {
      setBusy(false);
    }
  };

  const ablehnen = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await api.denyDevicePairing(pending.userCode);
      setStatus('abgelehnt');
    } catch (denyError) {
      setError(denyError instanceof Error ? denyError.message : 'Ablehnen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="page" style={{ maxWidth: 520 }}>
          <div className="empty">Wird geladen …</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page" style={{ maxWidth: 520 }}>
        <div className="page__header">
          <div>
            <h1 className="page__title">Gerät verbinden</h1>
            <p className="muted" style={{ marginBottom: 0 }}>
              {user ? `Angemeldet als ${user.name}` : 'Bitte zuerst anmelden.'}
            </p>
          </div>
        </div>

        {error ? <div className="notice">{error}</div> : null}

        {status === 'verbunden' && pending ? (
          <div className="card card--form">
            <h2 className="card__title">Verbunden</h2>
            <div className="notice notice--ok">
              „{pending.clientName}" darf jetzt mit deinem Konto arbeiten. Das Programm meldet sich
              innerhalb weniger Sekunden von selbst – dieses Fenster kann zu.
            </div>
            <p className="hint">
              Die Verbindung steht unter <a href="/konto">Mein Konto</a> und lässt sich dort
              jederzeit wieder trennen.
            </p>
          </div>
        ) : null}

        {status === 'abgelehnt' ? (
          <div className="card card--form">
            <h2 className="card__title">Abgelehnt</h2>
            <p className="muted">
              Es wurde nichts verbunden. Wenn du diese Anfrage nicht selbst ausgelöst hast, war
              vermutlich jemand anders am Werk – dann ist Ablehnen genau richtig gewesen.
            </p>
          </div>
        ) : null}

        {status === 'frage' && pending ? (
          <div className="card card--form">
            <h2 className="card__title">Zugriff erlauben?</h2>

            <p style={{ marginTop: 0 }}>
              <strong>{pending.clientName}</strong> möchte sich mit deinem Konto verbinden.
            </p>

            <div className="notice">
              Das Programm bekommt damit <strong>deine</strong> Rechte: Es sieht dieselben Projekte
              und Videos wie du, kann in deinem Namen kommentieren und – soweit du das darfst –
              Fassungen hochladen und herunterladen. Bestätige nur, wenn du diese Verbindung
              gerade selbst gestartet hast.
            </div>

            <div className="field">
              <span className="field__label">Code</span>
              <code
                style={{
                  display: 'block',
                  fontSize: 22,
                  letterSpacing: 4,
                  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
                }}
              >
                {pending.userCode}
              </code>
              <p className="hint">
                Dieser Code muss mit dem übereinstimmen, der auf dem anderen Gerät steht.
              </p>
            </div>

            <div className="dialog__actions">
              <button
                type="button"
                className="button button--ghost"
                disabled={busy}
                onClick={() => void ablehnen()}
              >
                Ablehnen
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={busy}
                onClick={() => void bestaetigen()}
              >
                {busy ? 'Wird verbunden …' : 'Verbinden'}
              </button>
            </div>
          </div>
        ) : null}

        {status === 'eingabe' ? (
          <form
            className="card card--form"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim()) void nachschlagen(code.trim());
            }}
          >
            <h2 className="card__title">Code eingeben</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Auf dem Gerät – im Plugin, in der App – steht ein achtstelliger Code. Trag ihn hier
              ein.
            </p>

            <div className="field">
              <label className="field__label" htmlFor="user-code">
                Code vom Gerät
              </label>
              <input
                id="user-code"
                className="input"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="KHFP-3RTM"
                maxLength={20}
                style={{ letterSpacing: 2, textTransform: 'uppercase' }}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
              <p className="hint">
                Groß- und Kleinschreibung sowie der Bindestrich sind egal.
              </p>
            </div>

            <div className="dialog__actions">
              <button
                type="submit"
                className="button button--primary"
                disabled={busy || code.trim().length < 8}
              >
                {busy ? 'Wird geprüft …' : 'Weiter'}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </AppShell>
  );
}
