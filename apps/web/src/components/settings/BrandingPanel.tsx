'use client';

import {
  APP_ICON_SIZE,
  LOCALES,
  LOCALE_NAMES,
  DEFAULT_BRAND_ACCENT,
  FAVICON_RECOMMENDED_SIZES,
  LOGO_MIME_TYPES,
  MAX_APP_ICON_BYTES,
  MAX_COMPANY_NAME_LENGTH,
  MAX_COMPANY_SHORT_LENGTH,
  MAX_FAVICON_BYTES,
  MAX_LOGO_BYTES,
} from '@klappe/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useBranding } from '@/lib/branding';
import { useT } from '@/lib/i18n';

/**
 * Erscheinungsbild des Workspace (Phase 10).
 *
 * Eingestellt wird **eine** Farbe – Hover-Ton und lesbare Schriftfarbe leiten
 * sich daraus ab. Wer drei Farben aufeinander abstimmen müsste, säße am Ende
 * vor weißer Schrift auf gelbem Grund.
 */
export function BrandingPanel() {
  const { branding, apply } = useBranding();
  const t = useT();
  const [title, setTitle] = useState(branding.title);
  const [accent, setAccent] = useState(branding.accent);
  const [companyName, setCompanyName] = useState(branding.companyName ?? '');
  const [companyShort, setCompanyShort] = useState(branding.companyShort ?? '');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const faviconRef = useRef<HTMLInputElement>(null);
  const appIconRef = useRef<HTMLInputElement>(null);

  // Beim ersten Laden steht noch der Standard im Kontext.
  useEffect(() => {
    setTitle(branding.title);
    setAccent(branding.accent);
    setCompanyName(branding.companyName ?? '');
    setCompanyShort(branding.companyShort ?? '');
  }, [branding.title, branding.accent, branding.companyName, branding.companyShort]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      apply(await api.updateBranding({ title, accent, companyName, companyShort }));
      setInfo(t('common.saved'));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async (file: File) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (file.size > MAX_LOGO_BYTES) {
        throw new Error(t('branding.logoTooBig', { kb: Math.round(MAX_LOGO_BYTES / 1024) }));
      }
      apply(await api.uploadLogo(file));
      setInfo(t('branding.logoTaken'));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t('common.uploadFailed'));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeLogo = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      apply(await api.removeLogo());
      setInfo(t('branding.logoRemoved'));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : t('common.removeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const uploadFavicon = async (file: File) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (file.size > MAX_FAVICON_BYTES) {
        throw new Error(
          t('branding.faviconTooBig', { kb: Math.round(MAX_FAVICON_BYTES / 1024) }),
        );
      }
      /*
       * Der Browser meldet für eine `.ico` je nach System `image/x-icon`,
       * `image/vnd.microsoft.icon` – oder gar nichts. Im letzten Fall wird der
       * verbreitetere der beiden Typen gesetzt, statt den Upload an einer
       * fehlenden Angabe scheitern zu lassen; die API prüft ohnehin nach.
       */
      apply(await api.uploadFavicon(file, file.type || 'image/x-icon'));
      setInfo(t('branding.faviconTaken'));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t('common.uploadFailed'));
    } finally {
      setBusy(false);
      if (faviconRef.current) faviconRef.current.value = '';
    }
  };

  const removeFavicon = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      apply(await api.removeFavicon());
      setInfo(t('branding.faviconRemoved'));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : t('common.removeFailed'));
    } finally {
      setBusy(false);
    }
  };

  const uploadAppIcon = async (file: File) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (file.size > MAX_APP_ICON_BYTES) {
        throw new Error(
          t('branding.appIconTooBig', { kb: Math.round(MAX_APP_ICON_BYTES / 1024) }),
        );
      }
      apply(await api.uploadAppIcon(file));
      setInfo(t('branding.appIconTaken'));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : t('common.uploadFailed'));
    } finally {
      setBusy(false);
      if (appIconRef.current) appIconRef.current.value = '';
    }
  };

  const removeAppIcon = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      apply(await api.removeAppIcon());
      setInfo(t('branding.appIconRemoved'));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : t('common.removeFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        {t('branding.subtitle')}
      </p>

      {error ? <div className="notice">{error}</div> : null}
      {info ? (
        <div className="card" style={{ padding: '10px 12px' }}>
          {info}
        </div>
      ) : null}

      <form
        className="card"
        style={{ padding: 20 }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="brand-title">
            {t('branding.title')}
          </label>
          <input
            id="brand-title"
            className="input"
            maxLength={60}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <p className="hint">{t('branding.titleHint')}</p>
        </div>

        {/* Sprache des Workspace (Phase 26) – wirkt sofort, nicht erst mit
            „Speichern": Wer hier umstellt, will das Ergebnis gleich sehen. */}
        <div className="field">
          <label className="field__label" htmlFor="workspace-locale">
            {t('locale.workspaceLabel')}
          </label>
          <select
            id="workspace-locale"
            className="select"
            style={{ maxWidth: 320 }}
            disabled={busy}
            value={branding.defaultLocale}
            onChange={(event) => {
              setBusy(true);
              void api
                .updateBranding({ defaultLocale: event.target.value })
                .then(apply)
                .catch((fehler) =>
                  setError(fehler instanceof Error ? fehler.message : t('common.saveFailed')),
                )
                .finally(() => setBusy(false));
            }}
          >
            {LOCALES.map((eintrag) => (
              <option key={eintrag} value={eintrag}>
                {LOCALE_NAMES[eintrag]}
              </option>
            ))}
          </select>
          <p className="hint">{t('locale.workspaceHint')}</p>
        </div>

        <div className="grid-two">
          <div className="field">
            <label className="field__label" htmlFor="company-name">
              {t('branding.companyName')}
            </label>
            <input
              id="company-name"
              className="input"
              maxLength={MAX_COMPANY_NAME_LENGTH}
              placeholder={t('branding.companyPlaceholder')}
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
            />
            <p className="hint">{t('branding.companyHint')}</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="company-short">
              {t('branding.companyShort')}
            </label>
            <input
              id="company-short"
              className="input"
              maxLength={MAX_COMPANY_SHORT_LENGTH}
              placeholder={t('branding.companyShortPlaceholder')}
              value={companyShort}
              onChange={(event) => setCompanyShort(event.target.value)}
            />
            <p className="hint">
              {t('branding.companyShortHint')}
            </p>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="brand-accent">
            {t('branding.accent')}
          </label>
          <div className="toolbar">
            <input
              id="brand-accent"
              type="color"
              className="colorinput"
              value={accent}
              onChange={(event) => setAccent(event.target.value)}
            />
            <input
              className="input mono"
              style={{ width: 130 }}
              value={accent}
              onChange={(event) => setAccent(event.target.value)}
              aria-label={t('branding.accentHex')}
            />
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setAccent(DEFAULT_BRAND_ACCENT)}
            >
              {t('branding.reset')}
            </button>
          </div>
          <p className="hint">
            {t('branding.accentHint')}
          </p>
        </div>

        <div className="field">
          <span className="field__label">{t('branding.preview')}</span>
          <div className="brandpreview">
            <span className="brandpreview__mark">{t('branding.previewMark')}</span>
            <button type="button" className="button button--primary">
              {t('branding.previewButton')}
            </button>
            <span className="badge badge--ready">{t('branding.previewBadge')}</span>
          </div>
        </div>

        <div className="field">
          <span className="field__label">{t('branding.logo')}</span>
          <div className="toolbar">
            {branding.logoUrl ? (
              // Bewusst als <img>: ein SVG-Logo führt so keine Skripte aus.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="brandpreview__logo" src={branding.logoUrl} alt={t('branding.currentLogo')} />
            ) : (
              <span className="faint" style={{ fontSize: 13 }}>
                {t('branding.noLogo')}
              </span>
            )}
            <div className="shell__spacer" />
            <input
              ref={fileRef}
              type="file"
              accept={LOGO_MIME_TYPES.join(',')}
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadLogo(file);
              }}
            />
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {branding.logoUrl ? t('branding.replaceLogo') : t('branding.uploadLogo')}
            </button>
            {branding.logoUrl ? (
              <button
                type="button"
                className="button button--ghost"
                disabled={busy}
                onClick={() => void removeLogo()}
              >
                Entfernen
              </button>
            ) : null}
          </div>
          <p className="hint">
            {t('branding.logoHint', { kb: Math.round(MAX_LOGO_BYTES / 1024) })}
          </p>
        </div>

        {/*
         * Tab-Symbol und App-Symbol werden fertig hochgeladen (Phase 24).
         *
         * Vorher stand hier eine Auswahl „Standard / Logo / eigenes", und im
         * Fall „Logo" rechnete der Browser daraus selbst ein Symbol. Das
         * Ergebnis passte selten: Ein Zeichen, das im 16-Pixel-Tab bestehen
         * soll, entsteht nicht durch Verkleinern eines Schriftzugs. Wer sein
         * Symbol genau haben will, baut es ohnehin außerhalb – zwei Felder mit
         * klarer Größenangabe sind ehrlicher als eine Automatik, die man
         * hinterher zurechtbiegt.
         */}
        <div className="field">
          <span className="field__label">{t('branding.favicon')}</span>
          <div className="toolbar">
            {branding.faviconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.faviconUrl}
                alt={t('branding.currentFavicon')}
                width={32}
                height={32}
                style={{ borderRadius: 4 }}
              />
            ) : (
              <span className="faint" style={{ fontSize: 13 }}>
                {t('branding.noFavicon')}
              </span>
            )}
            <div className="shell__spacer" />
            <input
              ref={faviconRef}
              type="file"
              accept=".ico,image/x-icon,image/vnd.microsoft.icon"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadFavicon(file);
              }}
            />
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => faviconRef.current?.click()}
            >
              {branding.faviconUrl ? t('branding.replaceFavicon') : t('branding.uploadFavicon')}
            </button>
            {branding.faviconUrl ? (
              <button
                type="button"
                className="button button--ghost"
                disabled={busy}
                onClick={() => void removeFavicon()}
              >
                Entfernen
              </button>
            ) : null}
          </div>
          <p className="hint">
            {t('branding.faviconHintStart')} <strong>.ico</strong>
            {t('branding.faviconHintSize', { kb: Math.round(MAX_FAVICON_BYTES / 1024) })}{' '}
            <strong>
              {t('branding.faviconRecommended', { sizes: FAVICON_RECOMMENDED_SIZES.join(', ') })}
            </strong>{' '}
            {t('branding.faviconHintEnd')}
          </p>
        </div>

        <div className="field">
          <span className="field__label">{t('branding.appIcon')}</span>
          <div className="toolbar">
            {branding.appIconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.appIconUrl}
                alt={t('branding.currentAppIcon')}
                width={44}
                height={44}
                style={{ borderRadius: 10, background: 'var(--klappe-surface-raised)' }}
              />
            ) : (
              <span className="faint" style={{ fontSize: 13 }}>
                {t('branding.noAppIcon')}
              </span>
            )}
            <div className="shell__spacer" />
            <input
              ref={appIconRef}
              type="file"
              accept=".png,image/png"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadAppIcon(file);
              }}
            />
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => appIconRef.current?.click()}
            >
              {branding.appIconUrl ? t('branding.replaceAppIcon') : t('branding.uploadAppIcon')}
            </button>
            {branding.appIconUrl ? (
              <button
                type="button"
                className="button button--ghost"
                disabled={busy}
                onClick={() => void removeAppIcon()}
              >
                Entfernen
              </button>
            ) : null}
          </div>
          <p className="hint">
            {t('branding.appIconHintStart')} <strong>PNG</strong>
            {t('branding.appIconHintSize', { kb: Math.round(MAX_APP_ICON_BYTES / 1024) })}{' '}
            <strong>{t('branding.appIconRecommended', { size: APP_ICON_SIZE })}</strong>{' '}
            {t('branding.appIconHintEnd')}
          </p>
        </div>

        <div className="toolbar" style={{ marginTop: 18 }}>
          <div className="shell__spacer" />
          <button type="submit" className="button button--primary" disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </>
  );
}
