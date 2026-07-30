'use client';

import type { GuestAccessDto, ShareScope, VideoDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { useUserName } from '@/lib/user-name';
import { ShareManager } from '@/components/ShareManager';
import { IconButton } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';

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
function herkunft(link: GuestAccessDto['links'][number], scope: ShareScope): string {
  if (link.isDirect) {
    return link.scope === 'PROJECT'
      ? 'direkt fürs ganze Projekt freigegeben'
      : scope === 'PROJECT'
        ? `direkt freigegeben · nur „${link.targetName}“`
        : 'direkt für dieses Video freigegeben';
  }
  if (link.scope === 'PROJECT') return 'über die Projektfreigabe';
  return scope === 'PROJECT'
    ? `über eine Videofreigabe · nur „${link.targetName}“`
    : 'über die Videofreigabe';
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
}: {
  scope: ShareScope;
  projectId: string;
  videoId?: string;
  targetLabel: string;
}) {
  const [guests, setGuests] = useState<GuestAccessDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const zeigeName = useUserName();
  const [verwaltung, setVerwaltung] = useState(false);
  /** Für welchen Gast ist der Erweitern-Kasten aufgeklappt? */
  const [erweitert, setErweitert] = useState<string | null>(null);
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
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    }
  }, [scope, projectId, videoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setzeRecht = async (
    shareLinkId: string,
    userId: string,
    recht: 'allowComments' | 'allowDownload' | 'allowUpload',
    wert: boolean,
  ) => {
    try {
      await api.setShareGuestRights(shareLinkId, userId, { [recht]: wert });
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
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
        setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
      }
    }
  };

  const erweitern = async (
    userId: string,
    ziel: { scope: 'PROJECT' } | { scope: 'VIDEO'; videoIds: string[] },
  ) => {
    setBusy(true);
    try {
      setGuests(await api.extendProjectGuest(projectId, userId, ziel));
      setErweitert(null);
      setGewaehlt([]);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Freigeben fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sharepanel">
      <div className="sharepanel__head">
        <span className="sharepanel__title">Freigaben</span>
        {guests.length > 0 ? <span className="badge">{guests.length}</span> : null}
        <div className="shell__spacer" />
        <IconButton icon="share" label="Freigabe-Links verwalten" onClick={() => setVerwaltung(true)} />
      </div>

      {error ? <div className="notice">{error}</div> : null}

      <div className="sharepanel__body">
        {guests.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, padding: '0 14px' }}>
            Noch niemand hier. Über das Symbol oben rechts entsteht ein Freigabe-Link.
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
              {!guest.isActive ? <div className="notice">Konto gesperrt.</div> : null}

              {guest.links.map((link) => {
                const geerbt = scope === 'VIDEO' && link.scope === 'PROJECT';
                const aktiv = link.linkActive && !link.revokedAt;
                return (
                  <div key={link.shareLinkId} className="sharepanel__link">
                    <div className="faint" style={{ fontSize: 12 }}>
                      {herkunft(link, scope)}
                      {link.label && !link.isDirect ? ` · ${link.label}` : ''}
                      {aktiv ? '' : ' · zurückgezogen'}
                      {link.hasOverride ? ' · abweichend vom Link' : ''}
                    </div>
                    {geerbt ? (
                      <div className="hint" style={{ margin: '2px 0 4px' }}>
                        Vom Projekt geerbt – eine Änderung hier gilt für alle Videos des Projekts.
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
                        kommentieren
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
                        herunterladen
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
                          hochladen
                        </label>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {/* Erweitern gibt es nur am Projekt – dort sieht man, was noch
                  fehlt. Und nur für Gäste, die noch nicht ohnehin alles sehen. */}
              {scope === 'PROJECT' && guest.canView && !hatGanzesProjekt(guest) ? (
                erweitert === guest.user.id ? (
                  <div className="sharepanel__erweitern">
                    <div className="faint" style={{ fontSize: 12, marginBottom: 6 }}>
                      Zugriff erweitern – ohne neuen Link, der Gast bleibt angemeldet.
                    </div>

                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => void erweitern(guest.user.id, { scope: 'PROJECT' })}
                    >
                      Ganzes Projekt freigeben
                    </button>

                    <div className="faint" style={{ fontSize: 12, margin: '10px 0 4px' }}>
                      …oder einzelne weitere Videos:
                    </div>
                    {videos.length === 0 ? (
                      <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                        Dieses Projekt hat noch keine Videos.
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
                            {schon ? <span className="faint"> · sieht er schon</span> : null}
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
                        Abbrechen
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
                          ? `${gewaehlt.length} Videos übernehmen`
                          : 'Video übernehmen'}
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
                    title="Weitere Videos oder das ganze Projekt freigeben – ohne neuen Link."
                  >
                    {erweitert === guest.user.id ? 'Weniger' : 'Zugriff erweitern'}
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
                        saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.',
                      );
                    }
                  }}
                  title="Wirkt am Projekt – dort gilt es für alle Videos gleichzeitig."
                >
                  {guest.canView ? 'Zugriff entziehen' : 'Zugriff zurückgeben'}
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
