'use client';

import {
  DEFAULT_BRAND_ACCENT,
  FAVICON_MIME_TYPES,
  type FaviconMode,
  LOGO_MIME_TYPES,
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

  /**
   * Der Modus wird sofort gespeichert, nicht erst mit dem Speichern-Knopf –
   * sonst stünde darunter ein Hochladen-Feld für eine Wahl, die noch gar
   * nicht gilt (Phase 23).
   */
  const setzeFaviconModus = async (faviconMode: FaviconMode) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      apply(await api.updateBranding({ faviconMode }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
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
          `Das Symbol darf höchstens ${Math.round(MAX_FAVICON_BYTES / 1024)} KB haben.`,
        );
      }
      apply(await api.uploadFavicon(file));
      setInfo('Tab-Symbol übernommen.');
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
      setInfo('Tab-Symbol entfernt.');
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
        <div className="card" style={{ padding: '10px 12px', marginBottom: 14 }}>
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

        {/* Tab-Symbol (Phase 23) */}
        <div className="field">
          <label className="field__label" htmlFor="favicon-mode">
            Symbol im Browser-Tab
          </label>
          <select
            id="favicon-mode"
            className="select"
            style={{ maxWidth: 320 }}
            value={branding.faviconMode}
            disabled={busy}
            onChange={(event) => void setzeFaviconModus(event.target.value as FaviconMode)}
          >
            <option value="standard">Standard (Klappe-Zeichen)</option>
            <option value="logo">Das Logo von oben</option>
            <option value="eigenes">Eigenes Symbol</option>
          </select>
          <p className="hint">
            Ein Tab-Symbol ist 16 Pixel groß. Ein breiter Schriftzug wird darin zu Brei – dafür
            gibt es die dritte Möglichkeit.
          </p>

          {branding.faviconMode === 'logo' && !branding.logoUrl ? (
            <div className="notice notice--warn">
              Es ist noch kein Logo hinterlegt – solange bleibt das Standard-Zeichen stehen.
            </div>
          ) : null}

          {branding.faviconMode === 'eigenes' ? (
            <div className="toolbar" style={{ marginTop: 8 }}>
              {branding.faviconUrl ? (
                // Bewusst als <img>: ein SVG führt so keine Skripte aus.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={branding.faviconUrl}
                  alt="Aktuelles Tab-Symbol"
                  width={24}
                  height={24}
                  style={{ borderRadius: 4 }}
                />
              ) : (
                <span className="faint" style={{ fontSize: 13 }}>
                  Noch kein eigenes Symbol – es gilt das Standard-Zeichen.
                </span>
              )}
              <div className="shell__spacer" />
              <input
                ref={faviconRef}
                type="file"
                accept={FAVICON_MIME_TYPES.join(',')}
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
                {branding.faviconUrl ? 'Symbol ersetzen' : 'Symbol hochladen'}
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
          ) : null}

          {branding.faviconMode === 'eigenes' ? (
            <p className="hint">
              PNG, SVG oder ICO, höchstens {Math.round(MAX_FAVICON_BYTES / 1024)} KB. Quadratisch
              und schlicht wirkt am besten – 32×32 Pixel genügen.
            </p>
          ) : null}
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
