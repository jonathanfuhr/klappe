'use client';

import {
  type NotificationSettingDto,
  type NotificationSettingsDto,
  MAX_PROJECT_FILE_DIGEST_MINUTES,
} from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { type MessageKey, useT } from '@/lib/i18n';

/**
 * Einstellungen → Benachrichtigungen (Phase 28).
 *
 * Bis hierher entschied allein der Code, welche Mail hinausging; der Admin
 * konnte nur den Versand als Ganzes abschalten. Hier steht jede Mailart mit
 * zwei Haken – „an das Team" und „an Gäste" – und
 * die beiden Ruhezeiten.
 *
 * Wichtig für die Erwartung: Der Schalter hier ist die **oberste** von drei
 * Ebenen. Er kann nur zumachen, nie jemandem etwas aufzwingen – darunter
 * greift weiter, wer eingetragen bzw. beteiligt ist, und ganz unten das
 * persönliche Abbestellen.
 */
export function NotificationsPanel() {
  const t = useT();
  const [settings, setSettings] = useState<NotificationSettingsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setSettings(await api.getNotificationSettings());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Jede Änderung liefert den frischen Stand zurück – eine Quelle genügt. */
  const aendern = async (aktion: () => Promise<NotificationSettingsDto>) => {
    setBusy(true);
    setError(null);
    try {
      setSettings(await aktion());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return <div className="empty">{error ?? t('common.loading')}</div>;
  }

  return (
    /*
     * Fragment statt Wrapper: Die Abstandsregel des Einstellungsbereichs
     * greift nur bei **direkten** Kindern von `.settingspage__body` – ein
     * Element dazwischen hebelt sie aus. Und `.card` bringt von sich aus kein
     * Padding mit; das setzt jedes Panel selbst, hier wie überall mit 20.
     */
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        {t('notifications.intro')}
      </p>

      {error ? <div className="notice notice--warn">{error}</div> : null}

      <div className="card" style={{ padding: 20 }}>
        <p className="hint" style={{ margin: '0 0 14px' }}>
          {t('notifications.layers')}
        </p>

        <table className="table">
          <thead>
            <tr>
              <th>{t('notifications.colKind')}</th>
              <th style={{ width: 110, textAlign: 'center' }}>{t('notifications.colTeam')}</th>
              <th style={{ width: 110, textAlign: 'center' }}>{t('notifications.colGuests')}</th>
            </tr>
          </thead>
          <tbody>
            {settings.kinds.map((eintrag) => (
              <KindRow
                key={eintrag.kind}
                eintrag={eintrag}
                busy={busy}
                onChange={(changes) =>
                  aendern(() =>
                    api.updateNotificationSettings({
                      kinds: [{ kind: eintrag.kind, ...changes }],
                    }),
                  )
                }
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px' }}>{t('notifications.digestTitle')}</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {t('notifications.digestIntro')}
        </p>

        <label className="field">
          <span className="field__label">{t('notifications.digestComments')}</span>
          <input
            className="input"
            type="number"
            min={0}
            max={120}
            value={settings.digestMinutes}
            onChange={(event) =>
              void aendern(() =>
                api.updateNotificationSettings({ digestMinutes: Number(event.target.value) || 0 }),
              )
            }
          />
          <p className="hint">{t('notifications.digestCommentsHint')}</p>
        </label>

        <label className="field">
          <span className="field__label">{t('notifications.digestFiles')}</span>
          <input
            className="input"
            type="number"
            min={0}
            max={MAX_PROJECT_FILE_DIGEST_MINUTES}
            value={settings.projectFileDigestMinutes}
            onChange={(event) =>
              void aendern(() =>
                api.updateNotificationSettings({
                  projectFileDigestMinutes: Number(event.target.value) || 0,
                }),
              )
            }
          />
          <p className="hint">{t('notifications.digestFilesHint')}</p>
        </label>

        <label className="switch">
          <input
            type="checkbox"
            checked={settings.mentionImmediate}
            disabled={busy}
            onChange={(event) =>
              void aendern(() =>
                api.updateNotificationSettings({ mentionImmediate: event.target.checked }),
              )
            }
          />
          {t('notifications.mentionImmediate')}
        </label>
        <p className="hint">{t('notifications.mentionImmediateHint')}</p>
      </div>

    </>
  );
}

/** Beschriftung und Erklärung je Mailart – die Schlüssel folgen dem Katalog. */
const BESCHRIFTUNG: Record<string, { name: MessageKey; hint: MessageKey }> = {
  'guest-code': { name: 'notifications.kindGuestCode', hint: 'notifications.kindGuestCodeHint' },
  'access-granted': { name: 'notifications.kindAccess', hint: 'notifications.kindAccessHint' },
  comment: { name: 'notifications.kindComment', hint: 'notifications.kindCommentHint' },
  mention: { name: 'notifications.kindMention', hint: 'notifications.kindMentionHint' },
  'project-file': { name: 'notifications.kindFile', hint: 'notifications.kindFileHint' },
  'version-ready': { name: 'notifications.kindVersion', hint: 'notifications.kindVersionHint' },
  'version-failed': { name: 'notifications.kindFailed', hint: 'notifications.kindFailedHint' },
  'guest-first-visit': { name: 'notifications.kindVisit', hint: 'notifications.kindVisitHint' },
  'cleanup-warning': { name: 'notifications.kindCleanup', hint: 'notifications.kindCleanupHint' },
  'backup-failed': { name: 'notifications.kindBackup', hint: 'notifications.kindBackupHint' },
  'device-paired': { name: 'notifications.kindDevice', hint: 'notifications.kindDeviceHint' },
};

function KindRow({
  eintrag,
  busy,
  onChange,
}: {
  eintrag: NotificationSettingDto;
  busy: boolean;
  onChange: (changes: { team?: boolean; guest?: boolean }) => void;
}) {
  const t = useT();
  const text = BESCHRIFTUNG[eintrag.kind];

  return (
    <tr>
      <td>
        <strong>{text ? t(text.name) : eintrag.kind}</strong>
        {text ? <div className="faint" style={{ fontSize: 13 }}>{t(text.hint)}</div> : null}
        {/* Der Anmeldecode steht bewusst ohne Schalter in der Liste: Ein Haken,
            der die Gastanmeldung stilllegt, ist keine Einstellung, sondern
            eine Falle. Weglassen wäre die schlechtere Antwort – dann fragte
            sich jemand, wo die Code-Mail geblieben ist. */}
        {eintrag.alwaysOn ? (
          <div className="badge" style={{ marginTop: 4 }}>
            {t('notifications.alwaysOn')}
          </div>
        ) : null}
      </td>
      <Zelle
        wert={eintrag.team}
        gesperrt={busy || eintrag.alwaysOn}
        onChange={(team) => onChange({ team })}
      />
      <Zelle
        wert={eintrag.guest}
        gesperrt={busy || eintrag.alwaysOn}
        onChange={(guest) => onChange({ guest })}
      />
    </tr>
  );
}

/** `null` heißt: Für diesen Kreis gibt es die Mail nicht – dann ein Strich. */
function Zelle({
  wert,
  gesperrt,
  onChange,
}: {
  wert: boolean | null;
  gesperrt: boolean;
  onChange: (wert: boolean) => void;
}) {
  if (wert === null) {
    return (
      <td style={{ textAlign: 'center' }} className="faint">
        –
      </td>
    );
  }
  return (
    <td style={{ textAlign: 'center' }}>
      <input
        type="checkbox"
        checked={wert}
        disabled={gesperrt}
        onChange={(event) => onChange(event.target.checked)}
      />
    </td>
  );
}
