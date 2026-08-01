'use client';

import type { GuestAccessDto, ShareScope, VideoDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { useUserName } from '@/lib/user-name';
import { ShareManager } from '@/components/ShareManager';
import { IconButton } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { type Translator, useT } from '@/lib/i18n';

/**
 * Die Spalte „Freigaben“ (Phase 16) – am Video und am Projekt dieselbe.
 *
 * Sie zeigt, wer hereinkommt und was er darf, und lässt die Rechte **pro
 * Person** setzen. Bisher trug allein der Link die Rechte; wer einem einzelnen
 * Gast den Download geben wollte, musste ihm einen eigenen Link bauen. Ein
 * gesetztes Häkchen weicht vom Link ab und wird als solches ausgewiesen.
 *
 * Am Video erscheinen auch die Gäste, die über eine **Projektfreigabe**
 * hereinkommen – das ist der häufigere Weg. Deren Rechte gelten für alle
 * Videos des Projekts; die Zeile sagt das dazu, damit niemand glaubt, er
 * ändere hier etwas nur für dieses eine Video.
 *
 * Seit Phase 18 steht am Projekt bei jedem Zugang, **worauf** er sich bezieht,
 * und wer nur einzelne Videos sieht, lässt sich mit einem Klick erweitern –
 * ohne neuen Link und ohne neue Mail.
 */
/**
 * Woher kommt dieser Zugang? In der Projektansicht steht bei einer
 * Videofreigabe **welches** Video gemeint ist – sonst liest sich die Zeile wie
 * ein voller Projektzugang (Phase 18). Am Video selbst wäre der Name nur eine
 * Wiederholung der Überschrift.
 */
function herkunft(
  link: GuestAccessDto['links'][number],
  scope: ShareScope,
  t: Translator,
): string {
  if (link.isDirect) {
    return link.scope === 'PROJECT'
      ? t('shares.directProject')
      : scope === 'PROJECT'
        ? t('shares.directVideoOnly', { name: link.targetName })
        : t('shares.directVideo');
  }
  if (link.scope === 'PROJECT') return t('shares.viaProjectShare');
  return scope === 'PROJECT'
    ? t('shares.viaVideoShareOnly', { name: link.targetName })
    : t('shares.viaVideoShare');
}

/** Zählt nur, was auch wirkt: gültiger Link, nicht entzogen. */
function wirksam(link: GuestAccessDto['links'][number]): boolean {
  return link.linkActive && link.revokedAt === null;
}

/** Sieht dieser Gast schon das ganze Projekt? Dann gibt es nichts zu erweitern. */
function hatGanzesProjekt(guest: GuestAccessDto): boolean {
  return guest.links.some((link) => link.scope === 'PROJECT' && wirksam(link));
}

/** Welche Videos der Gast über eine Videofreigabe schon erreicht. */
function sichtbareVideos(guest: GuestAccessDto): Set<string> {
  return new Set(
    guest.links.filter((link) => link.scope === 'VIDEO' && wirksam(link)).map((link) => link.targetId),
  );
}

export function SharePanel({
  scope,
  projectId,
  videoId,
  targetLabel,
  video,
  onVideoChanged,
}: {
  scope: ShareScope;
  projectId: string;
  videoId?: string;
  targetLabel: string;
  /**
   * Nur in der Videoansicht gesetzt (Phase 28). Der Haken „nur Endfassung"
   * gehört hierher und nicht über den Player: Wer fragt „darf der Kunde das
   * herunterladen?", schaut dort nach, wo die Rechte je Link und je Person
   * stehen.
   */
  video?: VideoDto | null;
  onVideoChanged?: () => Promise<void> | void;
}) {
  const t = useT();
  const { formatRelative } = useFormat();
  const [guests, setGuests] = useState<GuestAccessDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const zeigeName = useUserName();
  const [verwaltung, setVerwaltung] = useState(false);
  /** Für welchen Gast ist der Erweitern-Kasten aufgeklappt? */
  const [erweitert, setErweitert] = useState<string | null>(null);
  /** Bekommt der Gast einen Hinweis per Mail? (Phase 20) */
  const [bescheid, setBescheid] = useState(true);
  const [videos, setVideos] = useState<VideoDto[]>([]);
  const [gewaehlt, setGewaehlt] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setGuests(
        scope === 'VIDEO' && videoId
          ? await api.listVideoGuests(videoId)
          : await api.listProjectGuests(projectId),
      );
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    }
  }, [scope, projectId, videoId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const setzeRecht = async (
    shareLinkId: string,
    userId: string,
    recht: 'allowComments' | 'allowDownload' | 'allowUpload' | 'projectAdmin',
    wert: boolean,
  ) => {
    try {
      await api.setShareGuestRights(shareLinkId, userId, { [recht]: wert });
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
    }
  };

  /** Die Videoliste wird erst geholt, wenn jemand tatsächlich erweitern will. */
  const kastenAuf = async (userId: string) => {
    setGewaehlt([]);
    if (erweitert === userId) {
      setErweitert(null);
      return;
    }
    setErweitert(userId);
    if (videos.length === 0) {
      try {
        setVideos(await api.listVideos(projectId));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
      }
    }
  };

  const erweitern = async (
    userId: string,
    ziel: { scope: 'PROJECT' } | { scope: 'VIDEO'; videoIds: string[] },
  ) => {
    setBusy(true);
    try {
      setGuests(await api.extendProjectGuest(projectId, userId, { ...ziel, notify: bescheid }));
      setErweitert(null);
      setGewaehlt([]);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('shares.shareFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sharepanel">
      <div className="sharepanel__head">
        <span className="sharepanel__title">{t('shares.title')}</span>
        {guests.length > 0 ? <span className="badge">{guests.length}</span> : null}
        <div className="shell__spacer" />
        <IconButton icon="share" label={t('shares.manage')} onClick={() => setVerwaltung(true)} />
      </div>

      {error ? <div className="notice">{error}</div> : null}

      {/*
       * Bis Phase 28 standen hier drei Ebenen übereinander: das Recht am Link,
       * ein Schalter am Video und einer an jeder Fassung. Zwei davon sind
       * weggefallen – benutzt hat sie nie jemand, und über dem Player sagte
       * ein Haken namens „v3" niemandem, was er tut. Geblieben ist der eine
       * Fall, den der Link allein nicht ausdrücken kann.
       */}
      {video && onVideoChanged ? (
        <div style={{ padding: '0 14px 10px' }}>
          <label className="switch">
            <input
              type="checkbox"
              checked={video.downloadsFinalOnly}
              onChange={(event) => {
                void api
                  .updateVideo(video.id, { downloadsFinalOnly: event.target.checked })
                  .then(() => onVideoChanged());
              }}
            />
            {t('video.downloadFinalOnly')}
          </label>
          <p className="hint" style={{ marginTop: 4 }}>
            {t('video.downloadFinalOnlyHint')}
          </p>
        </div>
      ) : null}

      <div className="sharepanel__body">
        {guests.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, padding: '0 14px' }}>
            {t('shares.empty')}
          </p>
        ) : (
          guests.map((guest) => (
            <div key={guest.user.id} className="guest" data-blocked={!guest.isActive}>
              <div className="toolbar" style={{ gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{zeigeName(guest.user)}</strong>
                <div className="shell__spacer" />
                <span className="faint" style={{ fontSize: 12 }}>
                  {formatRelative(guest.lastSeenAt)}
                </span>
              </div>
              <span className="faint" style={{ fontSize: 12 }}>
                {guest.user.email}
              </span>
              {!guest.isActive ? <div className="notice">{t('shares.accountBlocked')}</div> : null}

              {guest.links.map((link) => {
                const geerbt = scope === 'VIDEO' && link.scope === 'PROJECT';
                const aktiv = link.linkActive && !link.revokedAt;
                return (
                  <div key={link.shareLinkId} className="sharepanel__link">
                    <div className="faint" style={{ fontSize: 12 }}>
                      {herkunft(link, scope, t)}
                      {link.label && !link.isDirect ? ` · ${link.label}` : ''}
                      {aktiv ? '' : t('shares.withdrawn')}
                      {link.hasOverride ? t('shares.differsFromLink') : ''}
                    </div>
                    {geerbt ? (
                      <div className="hint" style={{ margin: '2px 0 4px' }}>
                        {t('shares.inheritedHint')}
                      </div>
                    ) : null}
                    <div className="sharepanel__rights">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={link.allowComments}
                          disabled={!aktiv}
                          onChange={(event) =>
                            void setzeRecht(
                              link.shareLinkId,
                              guest.user.id,
                              'allowComments',
                              event.target.checked,
                            )
                          }
                        />
                        {t('shares.canComment')}
                      </label>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={link.allowDownload}
                          disabled={!aktiv}
                          onChange={(event) =>
                            void setzeRecht(
                              link.shareLinkId,
                              guest.user.id,
                              'allowDownload',
                              event.target.checked,
                            )
                          }
                        />
                        {t('shares.canDownload')}
                      </label>
                      {link.scope === 'PROJECT' ? (
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={link.allowUpload}
                            disabled={!aktiv}
                            onChange={(event) =>
                              void setzeRecht(
                                link.shareLinkId,
                                guest.user.id,
                                'allowUpload',
                                event.target.checked,
                              )
                            }
                          />
                          {t('shares.canUpload')}
                        </label>
                      ) : null}
                    </div>
                    {/* Nur an einer Projektfreigabe – eine Videofreigabe hat
                        keinen Projektrahmen, in dem sich das verwalten ließe. */}
                    {link.scope === 'PROJECT' ? (
                      <label
                        className="switch"
                        style={{ marginTop: 6 }}
                        title={t('shares.projectAdminHint')}
                      >
                        <input
                          type="checkbox"
                          checked={link.projectAdmin}
                          disabled={!aktiv}
                          onChange={(event) =>
                            void setzeRecht(
                              link.shareLinkId,
                              guest.user.id,
                              'projectAdmin',
                              event.target.checked,
                            )
                          }
                        />
                        {t('shares.projectAdmin')}
                      </label>
                    ) : null}
                  </div>
                );
              })}

              {/* Erweitern gibt es nur am Projekt – dort sieht man, was noch
                  fehlt. Und nur für Gäste, die noch nicht ohnehin alles sehen. */}
              {scope === 'PROJECT' && guest.canView && !hatGanzesProjekt(guest) ? (
                erweitert === guest.user.id ? (
                  <div className="sharepanel__erweitern">
                    <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>
                      {t('shares.extendHint')}
                    </div>

                    {/* Sichtbar, bevor der Klick kommt: Sonst ginge unbemerkt
                        Post an den Kunden raus (Phase 20). */}
                    <label className="switch" style={{ marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={bescheid}
                        disabled={busy}
                        onChange={(event) => setBescheid(event.target.checked)}
                      />
                      {t('shares.notifyByMail')}
                    </label>

                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => void erweitern(guest.user.id, { scope: 'PROJECT' })}
                    >
                      {t('shares.shareWholeProject')}
                    </button>

                    <div className="faint" style={{ fontSize: 12, margin: '10px 0 4px' }}>
                      {t('shares.orSingleVideos')}
                    </div>
                    {videos.length === 0 ? (
                      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                        {t('shares.projectHasNoVideos')}
                      </p>
                    ) : (
                      videos.map((video) => {
                        const schon = sichtbareVideos(guest).has(video.id);
                        return (
                          <label key={video.id} className="switch">
                            <input
                              type="checkbox"
                              disabled={schon || busy}
                              checked={schon || gewaehlt.includes(video.id)}
                              onChange={(event) =>
                                setGewaehlt((current) =>
                                  event.target.checked
                                    ? [...current, video.id]
                                    : current.filter((id) => id !== video.id),
                                )
                              }
                            />
                            {video.name}
                            {schon ? <span className="faint">{t('shares.alreadySees')}</span> : null}
                          </label>
                        );
                      })
                    )}

                    <div className="toolbar" style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => setErweitert(null)}
                      >
                        {t('common.cancel')}
                      </button>
                      <div className="shell__spacer" />
                      <button
                        type="button"
                        className="button button--primary"
                        disabled={busy || gewaehlt.length === 0}
                        onClick={() =>
                          void erweitern(guest.user.id, { scope: 'VIDEO', videoIds: gewaehlt })
                        }
                      >
                        {gewaehlt.length > 1
                          ? t('shares.takeOverVideos', { count: gewaehlt.length })
                          : t('shares.takeOverVideo')}
                      </button>
                    </div>
                  </div>
                ) : null
              ) : null}

              <div className="toolbar" style={{ marginTop: 6 }}>
                {scope === 'PROJECT' && guest.canView && !hatGanzesProjekt(guest) ? (
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => void kastenAuf(guest.user.id)}
                    title={t('shares.extendTitle')}
                  >
                    {erweitert === guest.user.id ? t('shares.less') : t('shares.extend')}
                  </button>
                ) : null}
                <div className="shell__spacer" />
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={async () => {
                    const entziehen = guest.canView;
                    try {
                      await api.setProjectGuestRevoked(projectId, guest.user.id, entziehen);
                      await load();
                    } catch (saveError) {
                      setError(
                        saveError instanceof Error ? saveError.message : t('common.saveFailed'),
                      );
                    }
                  }}
                  title={t('shares.revokeTitle')}
                >
                  {guest.canView ? t('shares.revoke') : t('shares.giveBack')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {verwaltung ? (
        <ShareManager
          scope={scope}
          projectId={scope === 'PROJECT' ? projectId : undefined}
          videoId={scope === 'VIDEO' ? videoId : undefined}
          targetLabel={targetLabel}
          onClose={() => {
            setVerwaltung(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
