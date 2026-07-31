'use client';

import type { SharePreviewDto } from '@klappe/shared';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/**
 * Einstieg für Gäste (Phase 6, umgebaut in Phase 20).
 *
 * Vorher stand bei *jedem* Besuch die volle Maske da – Name und Adresse, dann
 * der Code. Für einen Kunden, der zum zwanzigsten Mal auf denselben Link
 * klickt, war das eine Zumutung, und der Name war beim zweiten Mal ohnehin
 * schon bekannt.
 *
 * Jetzt: Wer noch angemeldet ist, geht ohne Zwischenschritt durch. Sonst
 * genügt die Adresse, dann der Code – und nur beim allerersten Mal wird nach
 * dem Namen gefragt. Ein Passwort gibt es weiterhin nicht; der Kunde soll
 * nichts anlegen müssen.
 */
export default function ShareGatePage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const router = useRouter();
  const { refresh } = useSession();
  const t = useT();

  const [share, setShare] = useState<SharePreviewDto | null>(null);
  const [step, setStep] = useState<'mail' | 'code' | 'name'>('mail');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [ziel, setZiel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const vorschau = await api.sharePreview(token);
      setShare(vorschau);
      setError(null);

      // Schon angemeldet? Dann direkt weiter. Ohne Sitzung antwortet die API
      // mit 401 – das ist der gewollte Rückfall auf die Maske, kein Fehler,
      // und deshalb steht hier auch keine Meldung.
      if (vorschau.isActive) {
        try {
          const { redirectPath } = await api.continueShare(token);
          router.replace(redirectPath);
          return;
        } catch {
          // weiter mit der Maske
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Diese Freigabe gibt es nicht.');
    } finally {
      setLoading(false);
    }
  }, [token, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestCode = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.requestGuestCode(token, { email });
      setStep('code');
      setInfo(`Wir haben einen Code an ${email} geschickt. Er gilt 15 Minuten.`);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : t('gate.codeSendFailed'),
      );
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.verifyGuestCode(token, { email, code });
      // Wie beim Team-Login: Ein verworfenes Cookie ist kein Fehler der API –
      // ohne diese Prüfung stünde der Gast wortlos wieder vor der Code-Abfrage.
      if (!(await refresh())) {
        setError(t('gate.cookieRejected'));
        return;
      }

      // Angemeldet ist er jetzt in jedem Fall. Fehlt nur noch der Name –
      // einmal, beim allerersten Besuch.
      if (result.needsName) {
        setZiel(result.redirectPath);
        setInfo(null);
        setStep('name');
        return;
      }
      router.replace(result.redirectPath);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : t('gate.codeWrong'));
    } finally {
      setBusy(false);
    }
  };

  const nameSpeichern = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.confirmGuestName(token, name);
      await refresh();
      router.replace(ziel ?? '/projekte');
    } catch (nameError) {
      setError(nameError instanceof Error ? nameError.message : t('gate.nameSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="gate">
        <div className="card gate__card">{t('common.loading')}</div>
      </div>
    );
  }

  if (!share) {
    return (
      <div className="gate">
        <div className="card gate__card">
          <BrandMark />
          <div className="notice">{error ?? t('gate.notFound')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="gate">
      <div className="card gate__card">
        <BrandMark />
        <p className="gate__target">
          {share.scope === 'PROJECT' ? t('gate.project') : t('gate.video')}{' '}
          <strong>{share.targetName}</strong>
          {share.scope === 'VIDEO' ? t('gate.videoInProject', { name: share.projectName ?? '' }) : ''}
        </p>

        {!share.isActive ? (
          <div className="notice">
            {t('gate.expired')}
          </div>
        ) : !share.mailReady ? (
          <div className="notice">
            {t('gate.noMail')}
          </div>
        ) : step === 'mail' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void requestCode();
            }}
          >
            <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
              {t('gate.askMail')}
            </p>

            <div className="field">
              <label className="field__label" htmlFor="gast-email">
                {t('common.email')}
              </label>
              <input
                id="gast-email"
                className="input"
                type="email"
                required
                autoFocus
                autoComplete="email"
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
              {busy ? t('gate.sendingCode') : t('gate.requestCode')}
            </button>
          </form>
        ) : step === 'code' ? (
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
                {t('gate.codeLabel')}
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
              {busy ? t('gate.checking') : t('login.submit')}
            </button>
            <button
              type="button"
              className="button button--ghost"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => {
                setStep('mail');
                setCode('');
                setError(null);
              }}
            >
              {t('gate.back')}
            </button>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void nameSpeichern();
            }}
          >
            <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
              {t('gate.askName')}
            </p>

            <div className="field">
              <label className="field__label" htmlFor="gast-name">
                {t('common.name')}
              </label>
              <input
                id="gast-name"
                className="input"
                required
                minLength={2}
                autoFocus
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            {error ? <div className="notice">{error}</div> : null}

            <button
              type="submit"
              className="button button--primary"
              style={{ width: '100%', marginTop: 10 }}
              disabled={busy || name.trim().length < 2}
            >
              {busy ? t('common.saving') : t('gate.continue')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
