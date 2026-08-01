'use client';

import type { NotificationSubscriberDto } from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { useUserName } from '@/lib/user-name';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * Die Spalte „Benachrichtigungen“ (Phase 18) – am Projekt und am Video
 * dieselbe, neben den Freigaben.
 *
 * Vorher entschied der Zufall, wer Post bekam: Wer eine Fassung hochgeladen
 * oder einmal kommentiert hatte, war dabei. Jetzt steht es hier. Eingetragen
 * wird fürs Projekt oder fürs einzelne Video, **nie** für eine Fassung – eine
 * neue Version ist derselbe Film.
 *
 * Wer übers Projekt dabei ist, erscheint am Video als „übers Projekt“ und
 * lässt sich dort nicht einzeln abwählen. Sonst müsste man zwei Zustände im
 * Kopf behalten, die einander widersprechen; wer es genauer will, nimmt den
 * Haken im Projekt heraus und setzt ihn an den Videos, die zählen.
 */
export function NotificationPanel({
  scope,
  projectId,
  videoId,
}: {
  scope: 'PROJECT' | 'VIDEO';
  projectId: string;
  videoId?: string;
}) {
  const t = useT();
  const [people, setPeople] = useState<NotificationSubscriberDto[]>([]);
  const zeigeName = useUserName();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPeople(
        scope === 'VIDEO' && videoId
          ? await api.listVideoSubscribers(videoId)
          : await api.listProjectSubscribers(projectId),
      );
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    }
  }, [scope, projectId, videoId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const umschalten = async (userId: string, subscribed: boolean) => {
    setBusy(userId);
    try {
      setPeople(
        scope === 'VIDEO' && videoId
          ? await api.setVideoSubscriber(videoId, userId, subscribed)
          : await api.setProjectSubscriber(projectId, userId, subscribed),
      );
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
    } finally {
      setBusy(null);
    }
  };

  const dabei = people.filter((person) => person.subscribed || person.inherited).length;

  return (
    <div className="sharepanel">
      <div className="sharepanel__head">
        <span className="sharepanel__title">{t('notifications.title')}</span>
        {dabei > 0 ? <span className="badge">{dabei}</span> : null}
      </div>

      {error ? <div className="notice">{error}</div> : null}

      <div className="sharepanel__body">
        <p className="hint" style={{ margin: '0 14px 10px' }}>
          {scope === 'VIDEO'
            ? t('notifications.hintVideo')
            : t('notifications.hintProject')}
        </p>

        {people.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, padding: '0 14px' }}>
            {t('notifications.noTeam')}
          </p>
        ) : (
          people.map((person) => (
            <div key={person.user.id} className="guest">
              <label className="switch" style={{ marginBottom: 2 }}>
                <input
                  type="checkbox"
                  checked={person.subscribed || person.inherited}
                  disabled={person.inherited || busy === person.user.id}
                  onChange={(event) => void umschalten(person.user.id, event.target.checked)}
                />
                <strong style={{ fontSize: 14 }}>{zeigeName(person.user)}</strong>
              </label>
              <span className="faint" style={{ fontSize: 12 }}>
                {person.user.email}
              </span>
              {person.inherited ? (
                <div className="hint" style={{ margin: '2px 0 0' }}>
                  {t('notifications.inherited')}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
