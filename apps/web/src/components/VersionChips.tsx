'use client';

import type { AiContentSettingsDto, VersionDto, VideoDto } from '@klappe/shared';
import { type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useAiKindName } from '@/lib/ai-kinds';
import { useFormat } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useUserName } from '@/lib/user-name';
import { Menu } from '@/components/ui/Menu';

/**
 * Der Zustand einer Fassung als Chips neben dem Titel (Phase 28).
 *
 * Vorher standen dieselben drei Eigenschaften **zweimal** über dem Player:
 * einmal als Warnbanner für alle und einmal als Haken in zwei Schalterleisten
 * fürs Team. Sechs Blöcke für drei Angaben – und die Haken trugen als
 * Beschriftung Dinge wie „v3", die niemandem sagten, was sie tun.
 *
 * Hier steht jede Eigenschaft **einmal**: als Chip, der den Zustand zeigt.
 * Fürs Team ist er zugleich der Schalter – ein Klick öffnet das zugehörige
 * Menü. Die Banner darunter bleiben, wo sie sind; sie erklären, was ein Chip
 * nur benennen kann.
 */
export function VersionChips({
  video,
  version,
  isTeam,
  aiKatalog,
  onChanged,
}: {
  video: VideoDto;
  version: VersionDto;
  isTeam: boolean;
  /** `null`, solange nicht geladen; abgeschaltet heißt `enabled: false`. */
  aiKatalog: AiContentSettingsDto | null;
  onChanged: () => Promise<void> | void;
}) {
  const t = useT();
  const kindName = useAiKindName();
  const { formatDateTime } = useFormat();
  const zeigeName = useUserName();

  const speichern = async (aktion: Promise<unknown>) => {
    await aktion;
    await onChanged();
  };

  return (
    <div className="chipbar">
      {/*
       * Sichtbarkeit. Für Gäste gibt es diesen Chip nicht: Eine interne
       * Fassung sehen sie ohnehin nicht, und „für dich sichtbar" an einer
       * Fassung, die sie gerade ansehen, wäre eine Auskunft ohne Inhalt.
       */}
      {isTeam ? (
        <ChipMenu
          label={version.internal ? t('video.internal') : t('video.chipVisible')}
          ton={version.internal ? 'warn' : 'neutral'}
        >
          <label className="switch">
            <input
              type="checkbox"
              checked={version.internal}
              onChange={(event) =>
                void speichern(api.updateVersion(version.id, { internal: event.target.checked }))
              }
            />
            {t('video.internalToggle')}
          </label>
          <p className="hint">{t('video.internalHint')}</p>
          {/* Wer wann freigegeben hat – die Frage stellt sich genau hier. */}
          {version.releasedAt ? (
            <p className="hint">
              {t('video.internalReleased', {
                name: version.releasedBy ? zeigeName(version.releasedBy) : '–',
                date: formatDateTime(version.releasedAt),
              })}
            </p>
          ) : null}
        </ChipMenu>
      ) : null}

      {/* Stand der Fassung – für alle sichtbar, denn er betrifft den Kunden. */}
      {isTeam ? (
        <ChipMenu
          label={version.isFinal ? t('video.isFinal') : t('video.chipDraft')}
          ton={version.isFinal ? 'ready' : 'neutral'}
        >
          <label className="switch">
            <input
              type="checkbox"
              checked={version.isFinal}
              onChange={(event) =>
                void speichern(api.updateVersion(version.id, { isFinal: event.target.checked }))
              }
            />
            {t('video.isFinal')}
          </label>
          <p className="hint">{t('video.isFinalHint')}</p>
        </ChipMenu>
      ) : (
        <span className={version.isFinal ? 'badge badge--ready' : 'badge'}>
          {version.isFinal ? t('video.isFinal') : t('video.chipDraft')}
        </span>
      )}

      {/*
       * KI-Kennzeichnung. Sie hängt am **Video**, nicht an der Fassung; ist
       * die Funktion im Workspace abgeschaltet, fehlt der Chip ganz.
       */}
      {aiKatalog?.enabled && isTeam ? (
        <ChipMenu
          label={t('video.aiToggle')}
          ton={video.aiContent ? 'accent' : 'neutral'}
          zusatz={video.aiContent && video.aiKinds.length > 0 ? video.aiKinds.length : null}
        >
          <label className="switch">
            <input
              type="checkbox"
              checked={video.aiContent}
              onChange={(event) =>
                void speichern(api.updateVideo(video.id, { aiContent: event.target.checked }))
              }
            />
            {t('video.aiToggle')}
          </label>
          <p className="hint">{t('video.aiToggleHint')}</p>

          {video.aiContent ? (
            aiKatalog.kinds.length > 0 ? (
              <div className="chipmenu__group">
                {aiKatalog.kinds.map((art) => {
                  const gewaehlt = video.aiKinds.some((eintrag) => eintrag.id === art.id);
                  return (
                    <label key={art.id} className="switch">
                      <input
                        type="checkbox"
                        checked={gewaehlt}
                        onChange={() =>
                          void speichern(
                            api.updateVideo(video.id, {
                              aiKindIds: gewaehlt
                                ? video.aiKinds
                                    .filter((eintrag) => eintrag.id !== art.id)
                                    .map((eintrag) => eintrag.id)
                                : [...video.aiKinds.map((eintrag) => eintrag.id), art.id],
                            }),
                          )
                        }
                      />
                      {kindName(art)}
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="hint">{t('video.aiNoKinds')}</p>
            )
          ) : null}
        </ChipMenu>
      ) : aiKatalog?.enabled && video.aiContent ? (
        <span className="badge badge--accent">{t('video.aiToggle')}</span>
      ) : null}
    </div>
  );
}

/** Ein Chip, der beim Klick sein Menü aufklappt. */
function ChipMenu({
  label,
  ton,
  zusatz,
  children,
}: {
  label: string;
  ton: 'neutral' | 'warn' | 'ready' | 'accent';
  /** Kleine Zahl hinter dem Namen, etwa die Anzahl gewählter KI-Arten. */
  zusatz?: number | null;
  children: ReactNode;
}) {
  return (
    <Menu
      // Mehrfach klicken muss möglich sein: Wer den Haken setzt, wählt danach
      // meist gleich die Arten dazu.
      closeOnSelect={false}
      align="left"
      trigger={
        <span className={`badge chip chip--${ton}`}>
          {label}
          {zusatz ? <span className="chip__count">{zusatz}</span> : null}
          <span aria-hidden>▾</span>
        </span>
      }
      triggerClassName="chip__trigger"
    >
      <div className="chipmenu">{children}</div>
    </Menu>
  );
}
