'use client';

import type { GuestOverviewDto } from '@klappe/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useSession } from '@/lib/session';

/**
 * Alle Gäste des Workspace auf einen Blick (Phase 9).
 *
 * Über Monate sammeln sich Kunden an, die längst nichts mehr zu suchen haben.
 * Hier stehen sie alle, mit den Projekten, die sie noch erreichen – und lassen
 * sich mit einem Klick aussperren, ohne jeden einzelnen Link zu suchen.
 */
export function GuestsPanel() {
  const { user } = useSession();
  const [guests, setGuests] = useState<GuestOverviewDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setGuests(await api.listAllGuests());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setActive = async (userId: string, isActive: boolean) => {
    setBusy(userId);
    setError(null);
    try {
      setGuests(await api.setGuestActive(userId, isActive));
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Ändern fehlgeschlagen.');
    } finally {
      setBusy(null);
    }
  };

  const term = search.trim().toLowerCase();
  const visible = term
    ? guests.filter(
        (guest) =>
          guest.user.name.toLowerCase().includes(term) ||
          guest.user.email.toLowerCase().includes(term) ||
          guest.projects.some((project) => project.name.toLowerCase().includes(term)),
      )
    : guests;

  const mitZugang = guests.filter((guest) => guest.isActive && guest.activeLinkCount > 0).length;

  return (
    <>
      <div>
        <div className="page__header">
          <div>
            <h2 className="page__title" style={{ fontSize: 20 }}>Gäste</h2>
            <p className="page__subtitle">
              {guests.length} {guests.length === 1 ? 'Gast' : 'Gäste'} insgesamt, {mitZugang} davon
              mit gültigem Zugang
            </p>
          </div>
          <div className="shell__spacer" />
          <input
            className="input"
            style={{ width: 240 }}
            placeholder="Name, Adresse oder Projekt …"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {error ? <div className="notice">{error}</div> : null}
        {loading ? <p className="muted">Wird geladen …</p> : null}

        {!loading && visible.length === 0 ? (
          <div className="empty">
            {guests.length === 0
              ? 'Noch niemand von außen. Gäste erscheinen hier, sobald sie einen Freigabe-Link benutzt haben.'
              : 'Kein Gast passt zur Suche.'}
          </div>
        ) : null}

        <div className="list">
          {visible.map((guest) => (
            <div className="guest" key={guest.user.id} data-blocked={!guest.isActive}>
              <div className="toolbar">
                <strong style={{ fontSize: 14 }}>{guest.user.name}</strong>
                <span className="faint" style={{ fontSize: 12 }}>
                  {guest.user.email}
                </span>
                {guest.isActive ? null : <span className="badge badge--failed">gesperrt</span>}
                <div className="shell__spacer" />
                <span className="faint" style={{ fontSize: 12 }}>
                  {guest.lastSeenAt
                    ? `zuletzt ${formatRelative(guest.lastSeenAt)}`
                    : 'noch nie angemeldet'}
                </span>
              </div>

              <div className="guest__rights">
                {guest.projects.length === 0 ? (
                  <span className="faint" style={{ fontSize: 13 }}>
                    Keine Freigabe mehr vorhanden
                  </span>
                ) : (
                  guest.projects.map((project) => (
                    <Link key={project.id} href={`/projekte/${project.id}`} className="badge">
                      {project.name}
                    </Link>
                  ))
                )}
              </div>

              <div className="toolbar">
                <span className="faint" style={{ fontSize: 12 }}>
                  {guest.activeLinkCount} von {guest.linkCount}{' '}
                  {guest.linkCount === 1 ? 'Freigabe' : 'Freigaben'} gültig · angelegt{' '}
                  {formatDateTime(guest.createdAt)}
                </span>
                <div className="shell__spacer" />
                {user?.role === 'ADMIN' ? (
                  <button
                    type="button"
                    className={guest.isActive ? 'button button--ghost' : 'button'}
                    disabled={busy === guest.user.id}
                    onClick={() => void setActive(guest.user.id, !guest.isActive)}
                  >
                    {guest.isActive ? 'Konto sperren' : 'Konto entsperren'}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
