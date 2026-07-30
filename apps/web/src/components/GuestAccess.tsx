'use client';

import type { GuestAccessDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { useUserName } from '@/lib/user-name';
import { api } from '@/lib/api';
import { formatRelative } from '@/lib/format';

interface GuestAccessProps {
  /** Genau eins von beiden setzen. */
  projectId?: string;
  videoId?: string;
}

/**
 * Wer hat hier Zugriff? (Phase 9)
 *
 * Die Freigabeverwaltung beantwortet „welche Links gibt es". Diese Liste
 * dreht die Frage um und zeigt Personen: über welche Links jemand
 * hereinkommt, was er darf und wann er zuletzt da war. Entzogen wird pro
 * Person, nicht pro Link – der Link soll für die anderen weiterlaufen.
 */
export function GuestAccess({ projectId, videoId }: GuestAccessProps) {
  const [guests, setGuests] = useState<GuestAccessDto[]>([]);
  const zeigeName = useUserName();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setGuests(
        projectId
          ? await api.listProjectGuests(projectId)
          : videoId
            ? await api.listVideoGuests(videoId)
            : [],
      );
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  }, [projectId, videoId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setRevoked = async (userId: string, revoked: boolean) => {
    if (!projectId) return;
    setBusy(userId);
    setError(null);
    try {
      setGuests(await api.setProjectGuestRevoked(projectId, userId, revoked));
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Ändern fehlgeschlagen.');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p className="muted">Wird geladen …</p>;

  return (
    <div className="guests">
      {error ? <div className="notice">{error}</div> : null}

      {guests.length === 0 ? (
        <div className="empty">
          Noch niemand von außen. Gäste erscheinen hier, sobald sie einen Freigabe-Link benutzt
          haben.
        </div>
      ) : null}

      {guests.map((guest) => (
        <div className="guest" key={guest.user.id} data-blocked={!guest.canView}>
          <div className="toolbar">
            <strong style={{ fontSize: 14 }}>{zeigeName(guest.user)}</strong>
            <span className="faint" style={{ fontSize: 12 }}>
              {guest.user.email}
            </span>
            <div className="shell__spacer" />
            <span className="faint" style={{ fontSize: 12 }}>
              zuletzt {formatRelative(guest.lastSeenAt)}
            </span>
          </div>

          <div className="guest__rights">
            {!guest.isActive ? (
              <span className="badge badge--failed">Konto gesperrt</span>
            ) : guest.canView ? (
              <>
                <span className="badge badge--ready">sieht mit</span>
                {guest.canComment ? <span className="badge">kommentiert</span> : null}
                {guest.canDownload ? <span className="badge">lädt herunter</span> : null}
                {guest.canUpload ? <span className="badge">lädt hoch</span> : null}
              </>
            ) : (
              <span className="badge badge--failed">kein Zugriff mehr</span>
            )}
          </div>

          <ul className="guest__links">
            {guest.links.map((link) => (
              <li key={link.shareLinkId}>
                <span className="faint">{link.scope === 'PROJECT' ? 'Projekt' : 'Video'}</span>{' '}
                {link.targetName}
                {link.label ? ` · ${link.label}` : ''}
                {link.revokedAt ? (
                  <span className="badge badge--failed" style={{ marginLeft: 6 }}>
                    entzogen
                  </span>
                ) : !link.linkActive ? (
                  <span className="badge badge--failed" style={{ marginLeft: 6 }}>
                    Link zurückgezogen
                  </span>
                ) : null}
              </li>
            ))}
          </ul>

          {projectId ? (
            <div className="toolbar">
              <div className="shell__spacer" />
              {guest.links.some((link) => link.revokedAt) ? (
                <button
                  type="button"
                  className="button"
                  disabled={busy === guest.user.id}
                  onClick={() => void setRevoked(guest.user.id, false)}
                >
                  Zugriff zurückgeben
                </button>
              ) : (
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busy === guest.user.id}
                  onClick={() => void setRevoked(guest.user.id, true)}
                >
                  Zugriff entziehen
                </button>
              )}
            </div>
          ) : (
            <p className="hint">
              Entzogen wird am Projekt – dort gilt es für alle Videos gleichzeitig.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
