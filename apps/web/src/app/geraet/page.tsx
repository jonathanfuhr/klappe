'use client';

import type { DevicePendingDto } from '@klappe/shared';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import { Trans, useT } from '@/lib/i18n';
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
  const t = useT();
  const params = useSearchParams();
  const { user, loading } = useSession();

  const [code, setCode] = useState('');
  const [pending, setPending] = useState<DevicePendingDto | null>(null);
  const [status, setStatus] = useState<'eingabe' | 'frage' | 'verbunden' | 'abgelehnt'>('eingabe');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nachschlagen = useCallback(
    async (eingabe: string) => {
      setBusy(true);
      setError(null);
      try {
        const gefunden = await api.describeDevicePairing(eingabe);
        setPending(gefunden);
        setCode(gefunden.userCode);
        setStatus('frage');
      } catch (lookupError) {
        setError(lookupError instanceof Error ? lookupError.message : t('pairing.codeWrong'));
        setStatus('eingabe');
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

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
      setError(approveError instanceof Error ? approveError.message : t('pairing.approveFailed'));
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
      setError(denyError instanceof Error ? denyError.message : t('pairing.denyFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="page" style={{ maxWidth: 520 }}>
          <div className="empty">{t('common.loading')}</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page" style={{ maxWidth: 520 }}>
        <div className="page__header">
          <div>
            <h1 className="page__title">{t('pairing.title')}</h1>
            <p className="muted" style={{ marginBottom: 0 }}>
              {user ? t('pairing.signedInAs', { name: user.name }) : t('pairing.signInFirst')}
            </p>
          </div>
        </div>

        {error ? <div className="notice">{error}</div> : null}

        {status === 'verbunden' && pending ? (
          <div className="card card--form">
            <h2 className="card__title">{t('pairing.doneTitle')}</h2>
            <div className="notice notice--ok">
              {t('pairing.doneText', { client: pending.clientName })}
            </div>
            <p className="hint">
              <Trans
                k="pairing.doneHint"
                parts={{ link: <a href="/konto">{t('account.title')}</a> }}
              />
            </p>
          </div>
        ) : null}

        {status === 'abgelehnt' ? (
          <div className="card card--form">
            <h2 className="card__title">{t('pairing.deniedTitle')}</h2>
            <p className="muted">{t('pairing.deniedText')}</p>
          </div>
        ) : null}

        {status === 'frage' && pending ? (
          <div className="card card--form">
            <h2 className="card__title">{t('pairing.askTitle')}</h2>

            <p style={{ marginTop: 0 }}>
              <Trans
                k="pairing.askIntro"
                parts={{ client: <strong>{pending.clientName}</strong> }}
              />
            </p>

            <div className="notice">{t('pairing.askWarning')}</div>

            <div className="field">
              <span className="field__label">{t('pairing.code')}</span>
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
              <p className="hint">{t('pairing.codeMatchHint')}</p>
            </div>

            <div className="dialog__actions">
              <button
                type="button"
                className="button button--ghost"
                disabled={busy}
                onClick={() => void ablehnen()}
              >
                {t('pairing.deny')}
              </button>
              <button
                type="button"
                className="button button--primary"
                disabled={busy}
                onClick={() => void bestaetigen()}
              >
                {busy ? t('pairing.approving') : t('pairing.approve')}
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
            <h2 className="card__title">{t('pairing.enterTitle')}</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              {t('pairing.enterHint')}
            </p>

            <div className="field">
              <label className="field__label" htmlFor="user-code">
                {t('pairing.codeLabel')}
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
              <p className="hint">{t('pairing.codeCaseHint')}</p>
            </div>

            <div className="dialog__actions">
              <button
                type="submit"
                className="button button--primary"
                disabled={busy || code.trim().length < 8}
              >
                {busy ? t('pairing.checking') : t('pairing.next')}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </AppShell>
  );
}
