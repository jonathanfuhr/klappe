'use client';

import type { GuestOverviewDto } from '@klappe/shared';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/**
 * Alle Gäste des Workspace auf einen Blick (Phase 9).
 *
 * Über Monate sammeln sich Kunden an, die längst nichts mehr zu suchen haben.
 * Hier stehen sie alle, mit den Projekten, die sie noch erreichen – und lassen
 * sich mit einem Klick aussperren, ohne jeden einzelnen Link zu suchen.
 */
export function GuestsPanel() {
  const t = useT();
  const { formatDateTime, formatRelative } = useFormat();
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
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const setActive = async (userId: string, isActive: boolean) => {
    setBusy(userId);
    setError(null);
    try {
      setGuests(await api.setGuestActive(userId, isActive));
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : t('common.changeFailed'));
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
            <p className="page__subtitle" style={{ marginTop: 0 }}>
              {t('guestsSettings.summary', { count: guests.length, active: mitZugang })}
            </p>
          </div>
          <div className="shell__spacer" />
          <input
            className="input"
            style={{ width: 240 }}
            placeholder={t('guestsSettings.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        {error ? <div className="notice">{error}</div> : null}
        {loading ? <p className="muted">{t('common.loading')}</p> : null}

        {!loading && visible.length === 0 ? (
          <div className="empty">
            {guests.length === 0
              ? t('guestsSettings.emptyNone')
              : t('guestsSettings.emptySearch')}
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
                {guest.isActive ? null : <span className="badge badge--failed">{t('guestsSettings.blocked')}</span>}
                <div className="shell__spacer" />
                <span className="faint" style={{ fontSize: 12 }}>
                  {guest.lastSeenAt
                    ? t('guestsSettings.lastSeen', { when: formatRelative(guest.lastSeenAt) })
                    : t('guestsSettings.neverSignedIn')}
                </span>
              </div>

              <div className="guest__rights">
                {guest.projects.length === 0 ? (
                  <span className="faint" style={{ fontSize: 13 }}>
                    {t('guestsSettings.noShareLeft')}
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
                  {t('guestsSettings.linkSummary', {
                    active: guest.activeLinkCount,
                    count: guest.linkCount,
                    created: formatDateTime(guest.createdAt),
                  })}
                </span>
                <div className="shell__spacer" />
                {user?.role === 'ADMIN' ? (
                  // Kein Weg mehr vom Gast ins Team (Phase 21): Gäste melden
                  // sich per Code an, das Team mit Passwort oder Microsoft
                  // 365 – ein Rollenwechsel hierher ergäbe ein Konto, das
                  // sich mit keinem der beiden anmelden könnte. Für einen
                  // echten Kollegen entsteht ein eigenes Konto unter
                  // "Benutzer".
                  <button
                    type="button"
                    className={guest.isActive ? 'button button--ghost' : 'button'}
                    disabled={busy === guest.user.id}
                    onClick={() => void setActive(guest.user.id, !guest.isActive)}
                  >
                    {guest.isActive ? t('guestsSettings.block') : t('guestsSettings.unblock')}
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
