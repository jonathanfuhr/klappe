'use client';

import type { AiContentSettingsDto } from '@klappe/shared';
import { MAX_AI_KIND_NAME_LENGTH } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAiKindName } from '@/lib/ai-kinds';
import { useT } from '@/lib/i18n';

/**
 * Einstellungen → KI-Inhalte (Phase 24, Nachtrag).
 *
 * Der globale Schalter und der Katalog der Arten, aus dem die Videoseite ihre
 * Auswahl anbietet – ab Werk KI-Stimme, KI-Video, KI-Sounds und KI-Musik.
 * Aufbau und Verhalten wie bei den Schlagworten: Abschalten blendet überall
 * aus, löscht aber nichts.
 */
export function AiPanel() {
  const t = useT();
  const kindName = useAiKindName();
  const [settings, setSettings] = useState<AiContentSettingsDto | null>(null);
  const [neuerName, setNeuerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await api.getAiSettings());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    }
  }, [t]);

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
      setError(changeError instanceof Error ? changeError.message : t('common.saveFailed'));
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
      !window.confirm(t('ai.deleteConfirm', { name: kindName(art), count: art.videoCount }))
    ) {
      return;
    }
    await aendern(() => api.deleteAiKind(art.id));
  };

  if (!settings) {
    return <div className="empty">{error ?? t('common.loading')}</div>;
  }

  return (
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        {t('ai.subtitle')}
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
          {t('ai.enable')}
        </label>
        <p className="hint">
          {t('ai.enableHint')}
        </p>

        {settings.enabled ? (
          <div
            style={{ marginTop: 18, borderTop: '1px solid var(--klappe-border)', paddingTop: 16 }}
          >
            <h2 className="section__title" style={{ marginBottom: 12 }}>
              {t('ai.kindsTitle')}
            </h2>
            <p className="hint">
              {t('ai.kindsHint')}
            </p>

            <div className="toolbar" style={{ marginBottom: 14 }}>
              <input
                className="input"
                placeholder={t('ai.newPlaceholder')}
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
                {t('common.create')}
              </button>
            </div>

            <div className="list">
              {settings.kinds.map((art) => {
                /*
                 * Die angezeigte Bezeichnung – bei den vier Werksarten die
                 * übersetzte. Sie steht im Feld **und** im Vergleich beim
                 * Verlassen: Verglichen mit `art.name` (immer Deutsch) würde
                 * bei englischer Oberfläche schon ein Klick ins Feld als
                 * Umbenennen durchgehen und der Art ihren Code nehmen.
                 *
                 * Der `key` trägt die Bezeichnung mit, damit ein
                 * Sprachwechsel das Feld neu aufbaut – `defaultValue` wirkt
                 * nur beim ersten Rendern.
                 */
                const anzeige = kindName(art);
                return (
                <div className="tagrow" key={`${art.id}-${anzeige}`}>
                  <input
                    className="input tagrow__name"
                    defaultValue={anzeige}
                    maxLength={MAX_AI_KIND_NAME_LENGTH}
                    aria-label={t('ai.kindNameLabel', { name: anzeige })}
                    onBlur={(event) => {
                      const neu = event.target.value.trim();
                      if (neu && neu !== anzeige) void aendern(() => api.renameAiKind(art.id, neu));
                    }}
                  />
                  <div className="tagrow__rest">
                    <span className="faint tagrow__count">
                      {t('ai.videoCount', { count: art.videoCount })}
                    </span>
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={busy}
                      onClick={() => void loeschen(art)}
                    >
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
                );
              })}

              {settings.kinds.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>
                  {t('ai.none')}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
