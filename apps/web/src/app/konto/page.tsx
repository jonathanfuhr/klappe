'use client';

import type { PasswordPolicy } from '@klappe/shared';
import {
  DEFAULT_PASSWORD_POLICY,
  LOCALES,
  LOCALE_NAMES,
  describePasswordPolicy,
  validatePassword,
} from '@klappe/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { useT } from '@/lib/i18n';
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
  const { user, refresh } = useSession();
  const { branding } = useBranding();
  const t = useT();
  const istGast = user?.role === 'GUEST';

  const [name, setName] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameDone, setNameDone] = useState(false);
  const [nameBerührt, setNameBerührt] = useState(false);

  useEffect(() => {
    if (user && !nameBerührt) setName(user.name);
  }, [user, nameBerührt]);

  const nameGetrimmt = name.trim();
  const nameGültig = nameGetrimmt.length >= 2 && nameGetrimmt.length <= 200;
  const nameGeändert = user ? nameGetrimmt !== user.name : false;

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  /**
   * Die Passwort-Regeln des Workspace (Phase 24). Sie standen hier bis dahin
   * als feste Zahl im Text – seit sie einstellbar sind, wäre das schlicht
   * gelogen. Bis die Antwort da ist, gilt der Vorgabewert.
   */
  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_PASSWORD_POLICY);
  useEffect(() => {
    void api
      .loginMethods()
      .then((methoden) => setPolicy(methoden.passwordPolicy))
      .catch(() => {
        // Ohne Antwort bleibt der Vorgabewert stehen; verbindlich prüft
        // ohnehin der Server.
      });
  }, []);

  const verstoss = next.length > 0 ? validatePassword(next, policy) : null;
  const ungleich = repeat.length > 0 && next !== repeat;
  const kannSpeichern =
    current.length > 0 && next.length > 0 && !verstoss && next === repeat && !busy;

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

        {/*
          * Sprache (Phase 26). Steht bewusst vor dem Passwort: Wer die
          * Oberfläche nicht versteht, soll das zuerst ändern können. Gilt auch
          * für Gäste – deren Mails gehen danach ebenfalls in dieser Sprache
          * raus.
          */}
        <div className="card card--form">
          <h2 className="card__title">{t('locale.label')}</h2>
          <div className="field">
            <label className="field__label" htmlFor="own-locale">
              {t('locale.label')}
            </label>
            <select
              id="own-locale"
              className="select"
              style={{ maxWidth: 320 }}
              value={user?.locale ?? ''}
              onChange={(event) => {
                void api.updateMe({ locale: event.target.value }).then(() => refresh());
              }}
            >
              <option value="">
                {t('locale.followWorkspace', { name: LOCALE_NAMES[branding.defaultLocale] })}
              </option>
              {LOCALES.map((eintrag) => (
                <option key={eintrag} value={eintrag}>
                  {LOCALE_NAMES[eintrag]}
                </option>
              ))}
            </select>
            <p className="hint">{t('locale.ownHint')}</p>
          </div>
        </div>

        <form
          className="card card--form"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!nameGültig || !nameGeändert) return;
            setNameBusy(true);
            setNameError(null);
            setNameDone(false);
            try {
              const gespeichert = await api.updateMe({ name: nameGetrimmt });
              setName(gespeichert.name);
              setNameBerührt(false);
              setNameDone(true);
              await refresh();
            } catch (nameSaveError) {
              setNameError(
                nameSaveError instanceof Error ? nameSaveError.message : 'Ändern fehlgeschlagen.',
              );
            } finally {
              setNameBusy(false);
            }
          }}
        >
          <h2 className="card__title">Name ändern</h2>

          {nameError ? <div className="notice">{nameError}</div> : null}
          {nameDone ? <div className="notice notice--ok">Der Name ist geändert.</div> : null}

          <div className="field">
            <label className="field__label" htmlFor="display-name">
              {istGast ? 'Anzeigename' : 'Name'}
            </label>
            <input
              id="display-name"
              className="input"
              type="text"
              autoComplete="name"
              required
              minLength={2}
              maxLength={200}
              value={name}
              onChange={(event) => {
                setNameBerührt(true);
                setName(event.target.value);
              }}
            />
            <p className="hint">
              {istGast
                ? 'So steht es in Kommentaren, Benachrichtigungen und Freigabelisten.'
                : 'So erscheinst du für dein Team und für Gäste.'}
            </p>
          </div>

          <div className="dialog__actions">
            <button
              type="submit"
              className="button button--primary"
              disabled={!nameGültig || !nameGeändert || nameBusy}
            >
              {nameBusy ? 'Wird gespeichert …' : 'Name speichern'}
            </button>
          </div>
        </form>

        {istGast ? null : (
        <>
        <form
          className="card card--form"
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
              {describePasswordPolicy(policy).join(', ')}.
              {verstoss ? ` ${verstoss}` : ''}
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
          <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>
            Passwörter anderer Konten setzt du unter <Link href="/benutzer">Benutzer</Link>.
          </p>
        ) : null}
        </>
        )}
      </div>
    </AppShell>
  );
}
