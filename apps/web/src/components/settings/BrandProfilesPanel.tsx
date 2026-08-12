'use client';

import type { BrandProfileDto } from '@klappe/shared';
import { MAX_COMPANY_SHORT_LENGTH, MAX_LOGO_BYTES } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * Verwaltung der Auftritte (1.6) – unter dem Erscheinungsbild des Hauses,
 * weil es dieselbe Frage in zwei Ausprägungen ist.
 *
 * Angelegt werden Auftritte in aller Regel dort, wo sie gebraucht werden: im
 * „…"-Menü eines Projekts. Hier steht, was daraus geworden ist – und vor
 * allem, an wie vielen Projekten ein Auftritt hängt. Das ist die Zahl, die
 * man vor einer Änderung sehen will: Sie trifft alle diese Projekte
 * zugleich, auch die längst abgeschlossenen.
 *
 * Löschen gibt es nicht. Ein Auftritt, der einmal an einem Projekt hing,
 * bleibt – das kostet eine Zeile und erspart die Frage, was mit den
 * Projekten geschehen soll, die noch daran hängen.
 */
export function BrandProfilesPanel() {
  const t = useT();
  const [auftritte, setAuftritte] = useState<BrandProfileDto[] | null>(null);
  const [offen, setOffen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const laden = useCallback(async () => {
    try {
      setAuftritte(await api.listBrandProfiles());
      setError(null);
    } catch (ladefehler) {
      setError(ladefehler instanceof Error ? ladefehler.message : t('common.loadFailed'));
      setAuftritte([]);
    }
  }, [t]);

  useEffect(() => {
    void laden();
  }, [laden]);

  return (
    <section style={{ marginTop: 34 }}>
      <h3>{t('brandProfiles.title')}</h3>
      <p className="hint">{t('brandProfiles.intro')}</p>

      {error ? <div className="notice">{error}</div> : null}

      {auftritte === null ? (
        <p className="hint">{t('common.loading')}</p>
      ) : auftritte.length === 0 ? (
        <p className="hint">{t('brandProfiles.empty')}</p>
      ) : (
        <div className="list">
          {auftritte.map((auftritt) => (
            <div key={auftritt.id} className="card" style={{ padding: 16 }}>
              <div className="toolbar">
                {auftritt.logoUrl ? (
                  // Bewusst als <img>: Ein hochgeladenes SVG könnte Skripte
                  // enthalten, die auf diesem Weg nicht ausgeführt werden.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={auftritt.logoUrl}
                    alt={auftritt.name}
                    style={{ height: 22, maxWidth: 120 }}
                  />
                ) : (
                  <span
                    aria-hidden
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 4,
                      background: auftritt.accent,
                      display: 'inline-block',
                    }}
                  />
                )}
                <strong>{auftritt.name}</strong>
                <span className="hint">
                  {t('brandProfiles.usage', { count: auftritt.projectCount })}
                </span>
                <div className="shell__spacer" />
                <button
                  type="button"
                  className="button"
                  onClick={() => setOffen(offen === auftritt.id ? null : auftritt.id)}
                >
                  {offen === auftritt.id ? t('common.close') : t('common.edit')}
                </button>
              </div>

              {offen === auftritt.id ? (
                <AuftrittFormular
                  auftritt={auftritt}
                  onSaved={async () => {
                    await laden();
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Die Felder eines Auftritts – aufgeklappt unter seiner Zeile. */
function AuftrittFormular({
  auftritt,
  onSaved,
}: {
  auftritt: BrandProfileDto;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState(auftritt.name);
  const [accent, setAccent] = useState(auftritt.accent);
  const [companyShort, setCompanyShort] = useState(auftritt.companyShort ?? '');
  const [mailFromName, setMailFromName] = useState(auftritt.mailFromName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mitFehlerfang(arbeit: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await arbeit();
      await onSaved();
    } catch (speicherfehler) {
      setError(speicherfehler instanceof Error ? speicherfehler.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      style={{ marginTop: 12 }}
      onSubmit={(event) => {
        event.preventDefault();
        void mitFehlerfang(() =>
          api.updateBrandProfile(auftritt.id, {
            name,
            accent,
            // Name und Firmenname bleiben beieinander – zwei Felder dafür
            // wären zwei Gelegenheiten, sie auseinanderlaufen zu lassen.
            companyName: name,
            companyShort,
            mailFromName,
          }),
        );
      }}
    >
      <div className="field">
        <label className="field__label" htmlFor={`auftritt-name-${auftritt.id}`}>
          {t('brandProfile.name')}
        </label>
        <input
          id={`auftritt-name-${auftritt.id}`}
          className="input"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={`auftritt-accent-${auftritt.id}`}>
          {t('brandProfile.accent')}
        </label>
        <input
          id={`auftritt-accent-${auftritt.id}`}
          className="input"
          value={accent}
          onChange={(event) => setAccent(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={`auftritt-short-${auftritt.id}`}>
          {t('brandProfile.companyShort')}
        </label>
        <input
          id={`auftritt-short-${auftritt.id}`}
          className="input"
          maxLength={MAX_COMPANY_SHORT_LENGTH}
          value={companyShort}
          onChange={(event) => setCompanyShort(event.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor={`auftritt-from-${auftritt.id}`}>
          {t('brandProfile.mailFromName')}
        </label>
        <input
          id={`auftritt-from-${auftritt.id}`}
          className="input"
          value={mailFromName}
          onChange={(event) => setMailFromName(event.target.value)}
        />
        <p className="hint">{t('brandProfile.mailFromNameHint')}</p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={`auftritt-logo-${auftritt.id}`}>
          {t('brandProfile.logo')}
        </label>
        <input
          id={`auftritt-logo-${auftritt.id}`}
          className="input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={(event) => {
            const datei = event.target.files?.[0];
            if (!datei) return;
            // Die Grenze schon hier, statt den Upload erst laufen zu lassen.
            if (datei.size > MAX_LOGO_BYTES) {
              setError(t('branding.logoTooBig', { kb: Math.round(MAX_LOGO_BYTES / 1024) }));
              return;
            }
            void mitFehlerfang(() => api.uploadBrandProfileLogo(auftritt.id, datei));
          }}
        />
        {auftritt.logoUrl ? (
          <button
            type="button"
            className="button button--ghost"
            style={{ marginTop: 8 }}
            disabled={busy}
            onClick={() => void mitFehlerfang(() => api.removeBrandProfileLogo(auftritt.id))}
          >
            {t('common.remove')}
          </button>
        ) : null}
      </div>

      {error ? <div className="notice">{error}</div> : null}

      <div className="toolbar" style={{ marginTop: 12 }}>
        <div className="shell__spacer" />
        <button type="submit" className="button button--primary" disabled={busy || !name.trim()}>
          {t('common.save')}
        </button>
      </div>
    </form>
  );
}
