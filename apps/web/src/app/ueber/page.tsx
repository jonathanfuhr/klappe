'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

const MAX_LENGTH = 4000;

/**
 * „Über diese Software": feste Angaben zu Klappe und zum Autor, plus ein
 * Freitext, den jeder Admin für die eigene Umgebung pflegt (Server im
 * Schrank, NAS, native Hardware …) – das kann Klappe nicht selbst wissen,
 * nur wer den Stack betreibt.
 *
 * Offen für alle Angemeldeten, auch Gäste; bearbeiten darf nur ein Admin.
 */
export default function AboutPage() {
  const t = useT();
  const { user } = useSession();
  const istAdmin = user?.role === 'ADMIN';

  const [notes, setNotes] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState('');
  const [bearbeiten, setBearbeiten] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const about = await api.getAbout();
      setNotes(about.environmentNotes);
      setUpdatedAt(about.updatedAt);
      setEntwurf(about.environmentNotes ?? '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const gespeichert = await api.updateAbout({ environmentNotes: entwurf });
      setNotes(gespeichert.environmentNotes);
      setUpdatedAt(gespeichert.updatedAt);
      setEntwurf(gespeichert.environmentNotes ?? '');
      setBearbeiten(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="page">
        <div className="page__header">
          <div>
            <h1 className="page__title">{t('about.title')}</h1>
            <p className="page__subtitle">{t('about.subtitle')}</p>
          </div>
        </div>

        <div className="manual">
          <section className="card manual__section">
            <h2>{t('about.klappeTitle')}</h2>
            <p>{t('about.klappeBody')}</p>
          </section>

          <section className="card manual__section">
            <h2>{t('about.authorTitle')}</h2>
            <p>
              {t('about.authorBodyStart')} <strong>THD Video</strong>{' '}
              {t('about.authorBodyEnd')}
            </p>
            <p>
              {t('about.contact')}{' '}
              <a href="mailto:jonathan@fuhrzwei.de">jonathan@fuhrzwei.de</a>
            </p>
          </section>

          {/* Lizenz und Quellcode gehören zusammen: Wer den Code holt, muss
              wissen, woran er dabei gebunden ist (Phase 24). */}
          <section className="card manual__section">
            <h2>{t('about.sourceTitle')}</h2>
            <p>
              {t('about.sourceBody')}{' '}
              <a href="https://github.com/jonathanfuhr/klappe" target="_blank" rel="noreferrer">
                github.com/jonathanfuhr/klappe
              </a>
            </p>
            <p>
              {t('about.licenseStart')}{' '}
              <a
                href="https://www.gnu.org/licenses/agpl-3.0.de.html"
                target="_blank"
                rel="noreferrer"
              >
                {t('about.licenseName')}
              </a>{' '}
              {t('about.licenseEnd')} <code>LICENSE</code> {t('about.licenseFileEnd')}
            </p>
          </section>

          <section className="card manual__section">
            <h2>{t('about.installationTitle')}</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              {t('about.installationHint')}
            </p>

            {error ? <div className="notice">{error}</div> : null}

            {!istAdmin || !bearbeiten ? (
              <>
                {notes ? (
                  <p style={{ whiteSpace: 'pre-wrap' }}>{notes}</p>
                ) : (
                  <p className="muted">{t('about.noNotes')}</p>
                )}
                {istAdmin ? (
                  <div className="toolbar" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="button"
                      onClick={() => {
                        setEntwurf(notes ?? '');
                        setBearbeiten(true);
                      }}
                    >
                      {t('common.edit')}
                    </button>
                    {updatedAt ? (
                      <span className="faint" style={{ fontSize: 12 }}>
                        {t('common.lastChanged', { when: formatDateTime(updatedAt) })}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <div className="field">
                  <label className="field__label" htmlFor="environment-notes">
                    {t('about.notesLabel')}
                  </label>
                  <textarea
                    id="environment-notes"
                    className="textarea"
                    style={{ minHeight: 140 }}
                    maxLength={MAX_LENGTH}
                    placeholder={t('about.notesPlaceholder')}
                    value={entwurf}
                    onChange={(event) => setEntwurf(event.target.value)}
                  />
                  <p className="hint">
                    {t('about.notesHint')}
                  </p>
                </div>
                <div className="toolbar">
                  <button type="submit" className="button button--primary" disabled={busy}>
                    {busy ? t('common.saving') : t('common.save')}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost"
                    disabled={busy}
                    onClick={() => {
                      setEntwurf(notes ?? '');
                      setBearbeiten(false);
                      setError(null);
                    }}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
