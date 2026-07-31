'use client';

import type { AiContentSettingsDto } from '@klappe/shared';
import { MAX_AI_KIND_NAME_LENGTH } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Einstellungen → KI-Inhalte (Phase 24, Nachtrag).
 *
 * Der globale Schalter und der Katalog der Arten, aus dem die Videoseite ihre
 * Auswahl anbietet – ab Werk KI-Stimme, KI-Video, KI-Sounds und KI-Musik.
 * Aufbau und Verhalten wie bei den Schlagworten: Abschalten blendet überall
 * aus, löscht aber nichts.
 */
export function AiPanel() {
  const [settings, setSettings] = useState<AiContentSettingsDto | null>(null);
  const [neuerName, setNeuerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await api.getAiSettings());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Jede Änderung liefert den frischen Stand zurück – eine Quelle genügt. */
  const aendern = async (aktion: () => Promise<AiContentSettingsDto>) => {
    setBusy(true);
    setError(null);
    try {
      setSettings(await aktion());
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const anlegen = async () => {
    if (!neuerName.trim()) return;
    await aendern(() => api.createAiKind(neuerName));
    setNeuerName('');
  };

  const loeschen = async (art: AiContentSettingsDto['kinds'][number]) => {
    if (
      art.videoCount > 0 &&
      !window.confirm(
        `„${art.name}" hängt an ${art.videoCount} ${
          art.videoCount === 1 ? 'Video' : 'Videos'
        } und verschwindet dort aus der Kennzeichnung. Trotzdem löschen?`,
      )
    ) {
      return;
    }
    await aendern(() => api.deleteAiKind(art.id));
  };

  if (!settings) {
    return <div className="empty">{error ?? 'Wird geladen …'}</div>;
  }

  return (
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        Videos lassen sich als KI-Inhalt kennzeichnen – über allen Fassungen erscheint dann der
        Hinweis zur Kennzeichnungspflicht nach Art. 50 EU AI Act, auch für Gäste.
      </p>

      {error ? <div className="notice">{error}</div> : null}

      <div className="card" style={{ padding: 20 }}>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy}
            onChange={(event) =>
              void aendern(() => api.updateAiSettings({ enabled: event.target.checked }))
            }
          />
          KI-Kennzeichnung verwenden
        </label>
        <p className="hint">
          Aus heißt: Haken, Auswahl und Hinweis verschwinden von allen Videoseiten. Gesetzte
          Kennzeichnungen bleiben gespeichert und kommen beim Wiedereinschalten zurück.
        </p>

        {settings.enabled ? (
          <div
            style={{ marginTop: 18, borderTop: '1px solid var(--klappe-border)', paddingTop: 16 }}
          >
            <h2 className="section__title" style={{ marginBottom: 12 }}>
              Arten von KI-Inhalten
            </h2>
            <p className="hint">
              Stehen am Video zur Auswahl und werden im Hinweis mitgenannt – etwa „KI-Stimme,
              KI-Musik".
            </p>

            <div className="toolbar" style={{ marginBottom: 14 }}>
              <input
                className="input"
                placeholder="Neue Art …"
                maxLength={MAX_AI_KIND_NAME_LENGTH}
                value={neuerName}
                onChange={(event) => setNeuerName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void anlegen();
                  }
                }}
              />
              <button
                type="button"
                className="button button--primary"
                disabled={busy || !neuerName.trim()}
                onClick={() => void anlegen()}
              >
                Anlegen
              </button>
            </div>

            <div className="list">
              {settings.kinds.map((art) => (
                <div className="tagrow" key={art.id}>
                  <input
                    className="input tagrow__name"
                    defaultValue={art.name}
                    maxLength={MAX_AI_KIND_NAME_LENGTH}
                    aria-label={`Bezeichnung der Art ${art.name}`}
                    onBlur={(event) => {
                      const neu = event.target.value.trim();
                      if (neu && neu !== art.name) void aendern(() => api.renameAiKind(art.id, neu));
                    }}
                  />
                  <div className="tagrow__rest">
                    <span className="faint tagrow__count">
                      {art.videoCount} {art.videoCount === 1 ? 'Video' : 'Videos'}
                    </span>
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={busy}
                      onClick={() => void loeschen(art)}
                    >
                      Löschen
                    </button>
                  </div>
                </div>
              ))}

              {settings.kinds.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>
                  Noch keine Arten angelegt.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
