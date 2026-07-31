'use client';

import {
  APP_ICON_SIZE,
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

/**
 * Erscheinungsbild des Workspace (Phase 10).
 *
 * Eingestellt wird **eine** Farbe – Hover-Ton und lesbare Schriftfarbe leiten
 * sich daraus ab. Wer drei Farben aufeinander abstimmen müsste, säße am Ende
 * vor weißer Schrift auf gelbem Grund.
 */
export function BrandingPanel() {
  const { branding, apply } = useBranding();
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
      setInfo('Gespeichert.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
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
        throw new Error(`Das Logo darf höchstens ${Math.round(MAX_LOGO_BYTES / 1024)} KB haben.`);
      }
      apply(await api.uploadLogo(file));
      setInfo('Logo übernommen.');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Hochladen fehlgeschlagen.');
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
      setInfo('Logo entfernt.');
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Entfernen fehlgeschlagen.');
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
          `Das Favicon darf höchstens ${Math.round(MAX_FAVICON_BYTES / 1024)} KB haben.`,
        );
      }
      /*
       * Der Browser meldet für eine `.ico` je nach System `image/x-icon`,
       * `image/vnd.microsoft.icon` – oder gar nichts. Im letzten Fall wird der
       * verbreitetere der beiden Typen gesetzt, statt den Upload an einer
       * fehlenden Angabe scheitern zu lassen; die API prüft ohnehin nach.
       */
      apply(await api.uploadFavicon(file, file.type || 'image/x-icon'));
      setInfo('Favicon übernommen.');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Hochladen fehlgeschlagen.');
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
      setInfo('Favicon entfernt.');
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Entfernen fehlgeschlagen.');
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
          `Das App-Symbol darf höchstens ${Math.round(MAX_APP_ICON_BYTES / 1024)} KB haben.`,
        );
      }
      apply(await api.uploadAppIcon(file));
      setInfo('App-Symbol übernommen.');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Hochladen fehlgeschlagen.');
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
      setInfo('App-Symbol entfernt.');
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Entfernen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        Titel, Logo und Farbe gelten überall – auch auf der Anmeldeseite, im Gastzugang und in jeder
        E-Mail.
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
            Titel
          </label>
          <input
            id="brand-title"
            className="input"
            maxLength={60}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <p className="hint">Steht im Kopf, im Browser-Tab und als Absenderzeile in den Mails.</p>
        </div>

        <div className="grid-two">
          <div className="field">
            <label className="field__label" htmlFor="company-name">
              Firmenname
            </label>
            <input
              id="company-name"
              className="input"
              maxLength={MAX_COMPANY_NAME_LENGTH}
              placeholder="z. B. Beispiel Medien GmbH"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
            />
            <p className="hint">Das Haus, dem dieser Workspace gehört.</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="company-short">
              Kürzel hinter den Benutzernamen
            </label>
            <input
              id="company-short"
              className="input"
              maxLength={MAX_COMPANY_SHORT_LENGTH}
              placeholder="z. B. BSP"
              value={companyShort}
              onChange={(event) => setCompanyShort(event.target.value)}
            />
            <p className="hint">
              Steht in Klammern hinter jedem Namen aus dem eigenen Team – an einem Kommentar ist
              damit zu sehen, wer von welcher Seite schreibt. Gäste bekommen keines. Leer lassen
              schaltet es ab.
            </p>
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="brand-accent">
            Akzentfarbe
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
              aria-label="Akzentfarbe als Hex-Wert"
            />
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setAccent(DEFAULT_BRAND_ACCENT)}
            >
              Zurücksetzen
            </button>
          </div>
          <p className="hint">
            Hover-Ton und Schriftfarbe darauf werden berechnet – eine Farbe genügt.
          </p>
        </div>

        <div className="field">
          <span className="field__label">Vorschau</span>
          <div className="brandpreview">
            <span className="brandpreview__mark">Beispiel</span>
            <button type="button" className="button button--primary">
              Freigabe erstellen
            </button>
            <span className="badge badge--ready">bereit</span>
          </div>
        </div>

        <div className="field">
          <span className="field__label">Logo</span>
          <div className="toolbar">
            {branding.logoUrl ? (
              // Bewusst als <img>: ein SVG-Logo führt so keine Skripte aus.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="brandpreview__logo" src={branding.logoUrl} alt="Aktuelles Logo" />
            ) : (
              <span className="faint" style={{ fontSize: 13 }}>
                Noch kein Logo hinterlegt.
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
              {branding.logoUrl ? 'Logo ersetzen' : 'Logo hochladen'}
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
            PNG, JPEG, WebP oder SVG, höchstens {Math.round(MAX_LOGO_BYTES / 1024)} KB. Es steht im
            Kopf neben dem Titel, wird also in der Höhe auf 22 Pixel gebracht.
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
          <span className="field__label">Symbol im Browser-Tab (Favicon)</span>
          <div className="toolbar">
            {branding.faviconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.faviconUrl}
                alt="Aktuelles Tab-Symbol"
                width={32}
                height={32}
                style={{ borderRadius: 4 }}
              />
            ) : (
              <span className="faint" style={{ fontSize: 13 }}>
                Noch keines hinterlegt – es gilt das Klappe-Zeichen.
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
              {branding.faviconUrl ? 'Favicon ersetzen' : 'Favicon hochladen'}
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
            Eine fertige <strong>.ico</strong>-Datei, höchstens{' '}
            {Math.round(MAX_FAVICON_BYTES / 1024)} KB.{' '}
            <strong>Empfohlen: {FAVICON_RECOMMENDED_SIZES.join(', ')} Pixel in einer Datei</strong>{' '}
            – eine .ico kann mehrere Größen zugleich enthalten, und der Browser nimmt sich die
            passende. Quadratisch und schlicht wirkt am besten; ein Schriftzug ist bei 16 Pixeln
            nicht mehr zu lesen. Erzeugen lässt sich so eine Datei mit jedem Favicon-Generator.
          </p>
        </div>

        <div className="field">
          <span className="field__label">App-Symbol für den Startbildschirm</span>
          <div className="toolbar">
            {branding.appIconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={branding.appIconUrl}
                alt="Aktuelles App-Symbol"
                width={44}
                height={44}
                style={{ borderRadius: 10, background: 'var(--klappe-surface-raised)' }}
              />
            ) : (
              <span className="faint" style={{ fontSize: 13 }}>
                Noch keines hinterlegt.
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
              {branding.appIconUrl ? 'App-Symbol ersetzen' : 'App-Symbol hochladen'}
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
            Ein <strong>PNG</strong>, höchstens {Math.round(MAX_APP_ICON_BYTES / 1024)} KB.{' '}
            <strong>
              Empfohlen: quadratisch, {APP_ICON_SIZE}×{APP_ICON_SIZE} Pixel
            </strong>{' '}
            – daraus rechnen iOS und Android alle kleineren Größen selbst. Es erscheint, wenn
            jemand Klappe über „Zum Home-Bildschirm" ablegt; ein SVG nimmt iOS dafür nicht an. Der
            Rand wird auf dem iPhone rund beschnitten, das Motiv sollte also etwas Luft haben.
          </p>
        </div>

        <div className="toolbar" style={{ marginTop: 18 }}>
          <div className="shell__spacer" />
          <button type="submit" className="button button--primary" disabled={busy}>
            Speichern
          </button>
        </div>
      </form>
    </>
  );
}
