'use client';

import type { SharePreviewDto } from '@klappe/shared';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Einstieg für Gäste (Phase 6).
 *
 * Vor dem ersten Blick aufs Video sind Name und E-Mail Pflicht; die Adresse
 * wird über einen sechsstelligen Code bestätigt. Ein Passwort gibt es
 * bewusst nicht – der Kunde soll nichts anlegen müssen.
 */
export default function ShareGatePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();
  const { refresh } = useSession();

  const [share, setShare] = useState<SharePreviewDto | null>(null);
  const [step, setStep] = useState<'daten' | 'code'>('daten');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setShare(await api.sharePreview(token));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Diese Freigabe gibt es nicht.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.requestGuestCode(token, { name, email });
      setStep('code');
      setInfo(`Wir haben einen Code an ${email} geschickt. Er gilt 15 Minuten.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Der Code ließ sich nicht verschicken.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.verifyGuestCode(token, { email, code });
      await refresh();
      router.replace(result.redirectPath);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Der Code stimmt nicht.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="gate">
        <div className="card gate__card">Wird geladen …</div>
      </div>
    );
  }

  if (!share) {
    return (
      <div className="gate">
        <div className="card gate__card">
          <div className="login__brand">
            <span className="shell__brand-mark" aria-hidden>
              ◗
            </span>
            Klappe
          </div>
          <div className="notice">{error ?? 'Diese Freigabe gibt es nicht.'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="gate">
      <div className="card gate__card">
        <div className="login__brand">
          <span className="shell__brand-mark" aria-hidden>
            ◗
          </span>
          Klappe
        </div>
        <p className="gate__target">
          {share.scope === 'PROJECT' ? 'Projekt' : 'Video'} <strong>{share.targetName}</strong>
          {share.scope === 'VIDEO' ? ` · Projekt ${share.projectName}` : ''}
        </p>

        {!share.isActive ? (
          <div className="notice">
            Diese Freigabe ist abgelaufen oder wurde zurückgezogen. Bitte wende dich an deinen
            Ansprechpartner.
          </div>
        ) : !share.mailReady ? (
          <div className="notice">
            Der Mailversand ist auf diesem Server noch nicht eingerichtet, deshalb kann kein
            Anmeldecode verschickt werden. Ein Administrator kann das unter Einstellungen nachholen.
          </div>
        ) : step === 'daten' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void requestCode();
            }}
          >
            <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
              Bitte Name und E-Mail-Adresse angeben. Wir schicken dir einen Code zur Bestätigung.
            </p>

            <div className="field">
              <label className="field__label" htmlFor="gast-name">
                Name
              </label>
              <input
                id="gast-name"
                className="input"
                required
                minLength={2}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="gast-email">
                E-Mail-Adresse
              </label>
              <input
                id="gast-email"
                className="input"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            {error ? <div className="notice">{error}</div> : null}

            <button
              type="submit"
              className="button button--primary"
              style={{ width: '100%', marginTop: 10 }}
              disabled={busy}
            >
              {busy ? 'Code wird geschickt …' : 'Code anfordern'}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void verify();
            }}
          >
            {info ? (
              <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
                {info}
              </p>
            ) : null}

            <div className="field">
              <label className="field__label" htmlFor="gast-code">
                Code aus der E-Mail
              </label>
              <input
                id="gast-code"
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

            {error ? <div className="notice">{error}</div> : null}

            <button
              type="submit"
              className="button button--primary"
              style={{ width: '100%', marginTop: 10 }}
              disabled={busy || code.length !== 6}
            >
              {busy ? 'Wird geprüft …' : 'Anmelden'}
            </button>
            <button
              type="button"
              className="button button--ghost"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => {
                setStep('daten');
                setCode('');
                setError(null);
              }}
            >
              Zurück
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
