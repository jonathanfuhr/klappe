'use client';

import type { GuestAccessDto, ShareScope } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
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
 */
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
  const [verwaltung, setVerwaltung] = useState(false);

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
                <strong style={{ fontSize: 14 }}>{guest.user.name}</strong>
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
                      {link.scope === 'PROJECT' ? 'über die Projektfreigabe' : 'über die Videofreigabe'}
                      {link.label ? ` · ${link.label}` : ''}
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

              <div className="toolbar" style={{ marginTop: 6 }}>
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
