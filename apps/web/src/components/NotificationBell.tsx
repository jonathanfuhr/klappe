'use client';

import type { NotificationDto } from '@klappe/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useFallbackInterval, useLive } from '@/lib/live';

/** Wie oft nach neuen Einträgen gesehen wird, solange die Seite offen ist. */
const POLL_MS = 60_000;

/**
 * Das Glöckchen in der Kopfzeile und die Benachrichtigungszentrale dahinter
 * (Phase 18).
 *
 * Hier landet dasselbe, was auch eine Mail auslöst – Kommentare zu Filmen, die
 * jemand verfolgt, und Erwähnungen. Der Unterschied: Es bleibt stehen. Wer die
 * Mail übersehen hat oder gar keinen Mailserver eingerichtet hat, findet es
 * trotzdem.
 *
 * Nur die Zahl wird regelmäßig geholt; die Liste erst beim Öffnen. Ein
 * geschlossenes Glöckchen soll nicht jede Minute fünfzig Zeilen nachladen.
 */
export function NotificationBell() {
  const router = useRouter();
  const t = useT();
  const { formatRelative } = useFormat();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<NotificationDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const huelle = useRef<HTMLDivElement>(null);

  const zaehlen = useCallback(async () => {
    try {
      const { unread: anzahl } = await api.unreadNotifications();
      setUnread(anzahl);
    } catch {
      // Eine abgelaufene Sitzung oder ein Netzhänger darf die Kopfzeile nicht
      // mit einer Fehlermeldung belegen – beim nächsten Takt klappt es wieder.
    }
  }, []);

  // Live: Das Glöckchen springt um, sobald etwas eintrifft (Phase 18).
  const { subscribe } = useLive();
  useEffect(
    () => subscribe((event) => {
      if (event.topic === 'notification') void zaehlen();
    }),
    [subscribe, zaehlen],
  );

  // Der Takt bleibt als Sicherheitsnetz – nur deutlich seltener, wenn die
  // Live-Verbindung steht.
  const takt = useFallbackInterval(POLL_MS);
  useEffect(() => {
    void zaehlen();
    if (takt === null) return;
    const timer = setInterval(() => void zaehlen(), takt);
    return () => clearInterval(timer);
  }, [zaehlen, takt]);

  // Klick daneben schließt.
  useEffect(() => {
    if (!open) return undefined;
    const zu = (event: MouseEvent) => {
      if (huelle.current && !huelle.current.contains(event.target as Node)) setOpen(false);
    };
    const taste = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', zu);
    document.addEventListener('keydown', taste);
    return () => {
      document.removeEventListener('mousedown', zu);
      document.removeEventListener('keydown', taste);
    };
  }, [open]);

  const oeffnen = async () => {
    const naechster = !open;
    setOpen(naechster);
    if (!naechster) return;

    setBusy(true);
    try {
      setEntries(await api.listNotifications(50));
    } catch {
      setEntries([]);
    } finally {
      setBusy(false);
    }
  };

  const allesGelesen = async () => {
    try {
      const { unread: anzahl } = await api.markNotificationsRead();
      setUnread(anzahl);
      setEntries((current) =>
        current?.map((entry) => ({ ...entry, readAt: entry.readAt ?? new Date().toISOString() })) ??
        null,
      );
    } catch {
      // Nichts zu tun – der nächste Takt holt den richtigen Stand.
    }
  };

  /**
   * Einen Eintrag wegräumen (Phase 29). Erst aus der Liste, dann melden: Ein
   * Tippen aufs × soll sofort wirken und nicht auf den Server warten.
   * Scheitert es, holt der Zähler den richtigen Stand – und die Liste wird
   * beim nächsten Öffnen ohnehin frisch geholt.
   */
  const entfernen = async (id: string) => {
    setEntries((current) => current?.filter((eintrag) => eintrag.id !== id) ?? null);
    try {
      const { unread: anzahl } = await api.deleteNotification(id);
      setUnread(anzahl);
    } catch {
      void zaehlen();
    }
  };

  /**
   * Die gelesenen Einträge wegräumen. Ungelesenes bleibt stehen, deshalb
   * wird hier gefiltert und nicht geleert – und der Zähler kommt vom Server,
   * statt hier auf 0 gesetzt zu werden: Er ändert sich nicht.
   */
  const gelesenEntfernen = async () => {
    setEntries((current) => current?.filter((eintrag) => eintrag.readAt === null) ?? null);
    try {
      const { unread: anzahl } = await api.clearReadNotifications();
      setUnread(anzahl);
    } catch {
      void zaehlen();
    }
  };

  const hingehen = async (entry: NotificationDto) => {
    setOpen(false);
    if (!entry.readAt) {
      try {
        const { unread: anzahl } = await api.markNotificationsRead([entry.id]);
        setUnread(anzahl);
      } catch {
        // Der Sprung ins Video ist wichtiger als der Lesestand.
      }
    }
    router.push(`/videos/${entry.videoId}`);
  };

  return (
    <div className="bell" ref={huelle}>
      <button
        type="button"
        className="iconbutton bell__button"
        onClick={() => void oeffnen()}
        aria-label={
          unread > 0 ? t('bell.unreadLabel', { count: unread }) : t('bell.title')
        }
        title={unread > 0 ? t('bell.unreadTitle', { count: unread }) : t('bell.title')}
        aria-expanded={open}
      >
        <Icon name="bell" />
        {unread > 0 ? <span className="bell__dot">{unread > 99 ? '99+' : unread}</span> : null}
      </button>

      {open ? (
        <div className="bell__panel" role="dialog" aria-label={t('bell.title')}>
          <div className="bell__head">
            <strong>{t('bell.title')}</strong>
            <div className="shell__spacer" />
            {unread > 0 ? (
              <button type="button" className="button button--ghost" onClick={() => void allesGelesen()}>
                {t('bell.markAllRead')}
              </button>
            ) : null}
            {/* Erst anbieten, wenn wirklich Gelesenes dasteht. Ein Knopf, der
                nur auf Ungelesenes zeigt, sähe wirkungslos aus – und wäre es
                auch. */}
            {entries?.some((eintrag) => eintrag.readAt !== null) ? (
              <button
                type="button"
                className="button button--ghost"
                onClick={() => void gelesenEntfernen()}
              >
                {t('bell.clearRead')}
              </button>
            ) : null}
          </div>

          <div className="bell__list">
            {busy && entries === null ? <p className="bell__leer">{t('common.loading')}</p> : null}
            {entries !== null && entries.length === 0 ? (
              <p className="bell__leer">{t('bell.empty')}</p>
            ) : null}

            {/* Der Eintrag war bis Phase 29 selbst ein Knopf. Das × darin
                wäre ein Knopf im Knopf gewesen – ungültiges HTML, und kein
                Browser trennt die beiden Klickflächen zuverlässig. Jetzt
                trägt eine Hülle die Auszeichnung, darin springt der linke
                Teil ins Video und der rechte räumt die Zeile weg. */}
            {(entries ?? []).map((entry) => (
              <div
                key={entry.id}
                className="bell__item"
                data-unread={entry.readAt === null}
                data-mention={entry.mentioned}
              >
                <button type="button" className="bell__hin" onClick={() => void hingehen(entry)}>
                  <span className="bell__zeile">
                    <strong>{entry.authorName}</strong>
                    {entry.mentioned ? <span className="badge">{t('bell.mentioned')}</span> : null}
                    <span className="shell__spacer" />
                    <span className="faint">{formatRelative(entry.createdAt)}</span>
                  </span>
                  <span className="bell__wo">
                    {entry.projectName} · {entry.videoName} · {entry.versionLabel}
                    {entry.timecode ? ` · ${entry.timecode}` : ''}
                    {entry.isReply ? t('bell.reply') : ''}
                  </span>
                  <span className="bell__text">{entry.excerpt}</span>
                </button>
                <button
                  type="button"
                  className="iconbutton bell__weg"
                  onClick={() => void entfernen(entry.id)}
                  aria-label={t('bell.remove')}
                  title={t('bell.remove')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
