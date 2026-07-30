'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
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
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    }
  }, []);

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
      setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="page">
        <div className="page__header">
          <div>
            <h1 className="page__title">Über diese Software</h1>
            <p className="page__subtitle">Was Klappe ist, wer sie gebaut hat, und wo sie läuft.</p>
          </div>
        </div>

        <div className="manual">
          <section className="card manual__section">
            <h2>Klappe</h2>
            <p>
              Klappe ist ein selbst gehostetes Review- und Freigabe-Werkzeug für
              Videoproduktionen – die eigene Alternative zu Frame.io. Schnittfassungen
              hochladen, frame-genau ansehen, am Bild kommentieren und zeichnen, per Link an
              Kunden freigeben, Rückmeldungen einsammeln, freigeben, herunterladen. Alles läuft
              im eigenen Docker-Stack: keine fremde Cloud, kein Abo pro Kopf, und das
              Kameramaterial verlässt das Haus nicht.
            </p>
          </section>

          <section className="card manual__section">
            <h2>Autor</h2>
            <p>
              Klappe wurde von <strong>Jonathan Fuhr</strong> gebaut, tätig bei{' '}
              <strong>THD Video Filmproduktion</strong>.
            </p>
            <p>
              Fragen, Fehlermeldungen oder Wünsche zur Weiterentwicklung:{' '}
              <a href="mailto:jonathan@fuhrzwei.de">jonathan@fuhrzwei.de</a>
            </p>
            <p>
              Quellcode auf GitHub:{' '}
              <a href="https://github.com/jonathanfuhr/klappe" target="_blank" rel="noreferrer">
                github.com/jonathanfuhr/klappe
              </a>{' '}
              – frei nutzbar für alle, die selbst einen Klappe-Stack betreiben wollen.
            </p>
          </section>

          <section className="card manual__section">
            <h2>Diese Installation</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              Freitext des Admins – etwa auf welcher Hardware oder in welcher Umgebung dieser
              Klappe-Stack läuft. Klappe kann das nicht selbst erkennen; das trägt nur ein Admin
              vor Ort ein.
            </p>

            {error ? <div className="notice">{error}</div> : null}

            {!istAdmin || !bearbeiten ? (
              <>
                {notes ? (
                  <p style={{ whiteSpace: 'pre-wrap' }}>{notes}</p>
                ) : (
                  <p className="muted">Noch keine Hinweise hinterlegt.</p>
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
                      Bearbeiten
                    </button>
                    {updatedAt ? (
                      <span className="faint" style={{ fontSize: 12 }}>
                        zuletzt geändert {formatDateTime(updatedAt)}
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
                    Hinweise zur Umgebung
                  </label>
                  <textarea
                    id="environment-notes"
                    className="textarea"
                    style={{ minHeight: 140 }}
                    maxLength={MAX_LENGTH}
                    placeholder="z. B. „läuft auf nativer Hardware, kein NAS, Backup läuft nachts um 3 Uhr auf den zweiten Server.“"
                    value={entwurf}
                    onChange={(event) => setEntwurf(event.target.value)}
                  />
                  <p className="hint">
                    Sichtbar für alle Angemeldeten, auch Gäste. Leer lassen entfernt den Hinweis
                    wieder.
                  </p>
                </div>
                <div className="toolbar">
                  <button type="submit" className="button button--primary" disabled={busy}>
                    {busy ? 'Wird gespeichert …' : 'Speichern'}
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
                    Abbrechen
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
