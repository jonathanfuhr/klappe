'use client';

import type { BrandProfileDto, ProjectDto } from '@klappe/shared';
import { MAX_COMPANY_SHORT_LENGTH } from '@klappe/shared';
import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * Auftritt eines Projekts wählen (1.6) – aus dem „…"-Menü der Projektseite.
 *
 * Bewusst dort und nicht bei Name und Kunde: Der Normalfall ist das eigene
 * Erscheinungsbild, und ein Schalter, der bei jedem Anlegen mit ins Formular
 * rutscht, wird irgendwann versehentlich umgelegt.
 *
 * Die Liste zeigt, was schon angelegt ist. Mehr braucht der Wunsch „beim
 * nächsten Projekt vorschlagen" nicht: Mit denselben Agenturen arbeiten wir
 * häufig, ihre Auftritte stehen also ohnehin da – geraten wird nichts.
 */
export function BrandProfileDialog({
  project,
  onClose,
  onSaved,
}: {
  project: ProjectDto;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const [auftritte, setAuftritte] = useState<BrandProfileDto[] | null>(null);
  const [gewaehlt, setGewaehlt] = useState<string | null>(project.brandProfile?.id ?? null);
  const [neu, setNeu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Felder für einen neu anzulegenden Auftritt.
  const [name, setName] = useState('');
  const [accent, setAccent] = useState('');
  const [companyShort, setCompanyShort] = useState('');
  const [mailFromName, setMailFromName] = useState('');
  const [logo, setLogo] = useState<File | null>(null);

  useEffect(() => {
    api
      .listBrandProfiles()
      .then(setAuftritte)
      .catch(() => setAuftritte([]));
  }, []);

  async function speichern(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let id = gewaehlt;

      if (neu) {
        const angelegt = await api.createBrandProfile({
          name,
          accent,
          // Der Firmenname ist zugleich der angezeigte Titel; ihn ein zweites
          // Mal abzufragen wäre eine Gelegenheit, ihn abweichend zu tippen.
          companyName: name,
          companyShort,
          mailFromName,
        });
        // Das Logo geht getrennt hinterher: Es ist eine Datei, kein Textfeld,
        // und der Auftritt braucht erst eine Kennung, unter der sie liegt.
        if (logo) await api.uploadBrandProfileLogo(angelegt.id, logo);
        id = angelegt.id;
      }

      await api.setProjectBrandProfile(project.id, id);
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={t('brandProfile.dialogTitle')} onClose={onClose}>
      <form onSubmit={speichern}>
        <p className="hint">{t('brandProfile.dialogHint')}</p>

        {auftritte === null ? (
          <p className="hint">{t('common.loading')}</p>
        ) : (
          <div className="field">
            <label className="field__label" htmlFor="brand-profile-choice">
              {t('brandProfile.choice')}
            </label>
            <select
              id="brand-profile-choice"
              className="input"
              value={neu ? 'neu' : (gewaehlt ?? '')}
              onChange={(event) => {
                const wert = event.target.value;
                setNeu(wert === 'neu');
                setGewaehlt(wert === 'neu' || wert === '' ? null : wert);
              }}
            >
              <option value="">{t('brandProfile.none')}</option>
              {auftritte.map((auftritt) => (
                <option key={auftritt.id} value={auftritt.id}>
                  {auftritt.name}
                </option>
              ))}
              <option value="neu">{t('brandProfile.createNew')}</option>
            </select>
          </div>
        )}

        {neu ? (
          <>
            <div className="field">
              <label className="field__label" htmlFor="brand-profile-name">
                {t('brandProfile.name')}
              </label>
              <input
                id="brand-profile-name"
                className="input"
                required
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <p className="hint">{t('brandProfile.nameHint')}</p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="brand-profile-logo">
                {t('brandProfile.logo')}
              </label>
              <input
                id="brand-profile-logo"
                className="input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(event) => setLogo(event.target.files?.[0] ?? null)}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="brand-profile-accent">
                {t('brandProfile.accent')}
              </label>
              <input
                id="brand-profile-accent"
                className="input"
                placeholder="#4c8dff"
                value={accent}
                onChange={(event) => setAccent(event.target.value)}
              />
              <p className="hint">{t('brandProfile.accentHint')}</p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="brand-profile-short">
                {t('brandProfile.companyShort')}
              </label>
              <input
                id="brand-profile-short"
                className="input"
                maxLength={MAX_COMPANY_SHORT_LENGTH}
                value={companyShort}
                onChange={(event) => setCompanyShort(event.target.value)}
              />
              <p className="hint">{t('brandProfile.companyShortHint')}</p>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="brand-profile-from">
                {t('brandProfile.mailFromName')}
              </label>
              <input
                id="brand-profile-from"
                className="input"
                value={mailFromName}
                onChange={(event) => setMailFromName(event.target.value)}
              />
              <p className="hint">{t('brandProfile.mailFromNameHint')}</p>
            </div>
          </>
        ) : null}

        {error ? <div className="notice">{error}</div> : null}

        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="button button--primary"
            disabled={busy || (neu && !name.trim())}
          >
            {t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
