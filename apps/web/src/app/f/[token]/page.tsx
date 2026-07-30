'use client';

import type { SharePreviewDto } from '@klappe/shared';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { api } from '@/lib/api';
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
        requestError instanceof Error ? requestError.message : 'Der Code ließ sich nicht verschicken.',
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
        setError(
          'Der Code stimmt, aber der Browser hat das Sitzungs-Cookie verworfen. ' +
            'Das passiert, wenn SESSION_COOKIE_SECURE=1 gesetzt ist, die Seite aber ' +
            'über http:// statt https:// aufgerufen wird.',
        );
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
      setError(verifyError instanceof Error ? verifyError.message : 'Der Code stimmt nicht.');
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
      setError(nameError instanceof Error ? nameError.message : 'Der Name ließ sich nicht speichern.');
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
          <BrandMark />
          <div className="notice">{error ?? 'Diese Freigabe gibt es nicht.'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="gate">
      <div className="card gate__card">
        <BrandMark />
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
        ) : step === 'mail' ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void requestCode();
            }}
          >
            <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
              Bitte deine E-Mail-Adresse angeben. Wir schicken dir einen Code zur Bestätigung.
            </p>

            <div className="field">
              <label className="field__label" htmlFor="gast-email">
                E-Mail-Adresse
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
              {busy ? 'Code wird geschickt …' : 'Code anfordern'}
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
                setStep('mail');
                setCode('');
                setError(null);
              }}
            >
              Zurück
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
              Willkommen. Wie sollen wir dich nennen? Das steht künftig an deinen Kommentaren – und
              wir fragen nur dieses eine Mal.
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
              {busy ? 'Wird gespeichert …' : 'Weiter'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
