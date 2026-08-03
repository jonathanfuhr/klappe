'use client';

import type {
  AworkCheckDto,
  AworkEvent,
  AworkFieldDto,
  AworkSettingsDto,
  ProjectFieldDefDto,
  UserDto,
} from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { type MessageKey, useT } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';

/**
 * Einstellungen → awork (Phase 30).
 *
 * Der Aufbau folgt der Reihenfolge, in der man die Anbindung einrichtet:
 * zuerst der Schlüssel und der Verbindungstest, dann die beiden Felder, über
 * die sich die Projekte finden, dann die Aufgaben und zuletzt die Schalter,
 * was überhaupt gemeldet wird. Solange die Verbindung nicht steht, sind die
 * Freifeld-Auswahlen leer – deshalb stehen sie hinter dem Test und nicht davor.
 */
const EREIGNIS_TEXTE: Record<AworkEvent, { name: MessageKey; hint: MessageKey }> = {
  korrekturen: { name: 'awork.eventKorrekturen', hint: 'awork.eventKorrekturenHint' },
  kundenmaterial: { name: 'awork.eventKundenmaterial', hint: 'awork.eventKundenmaterialHint' },
  erstbesuch: { name: 'awork.eventErstbesuch', hint: 'awork.eventErstbesuchHint' },
  'fassung-verfuegbar': { name: 'awork.eventFassung', hint: 'awork.eventFassungHint' },
  endfassung: { name: 'awork.eventEndfassung', hint: 'awork.eventEndfassungHint' },
  'aufgabe-erledigen': { name: 'awork.eventErledigen', hint: 'awork.eventErledigenHint' },
};

export function AworkPanel() {
  const t = useT();
  const [settings, setSettings] = useState<AworkSettingsDto | null>(null);
  const [klappeFelder, setKlappeFelder] = useState<ProjectFieldDefDto[]>([]);
  const [aworkFelder, setAworkFelder] = useState<AworkFieldDto[]>([]);
  const [team, setTeam] = useState<UserDto[]>([]);
  const [form, setForm] = useState({
    apiKey: '',
    projectNumberFieldId: '',
    aworkProjectNumberFieldId: '',
    taskListName: '',
    taskTitlePrefix: '',
    fallbackUserId: '',
  });
  const [pruefung, setPruefung] = useState<AworkCheckDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [aktuell, felder, nutzer] = await Promise.all([
        api.getAworkSettings(),
        api.listProjectFields(),
        api.listUsers(),
      ]);
      setSettings(aktuell);
      setKlappeFelder(felder);
      // Gäste haben in awork nichts verloren – sie taugen auch nicht als Rückfall.
      setTeam(nutzer.filter((person) => person.role !== 'GUEST' && person.isActive));
      setForm({
        apiKey: '',
        projectNumberFieldId: aktuell.projectNumberFieldId ?? '',
        aworkProjectNumberFieldId: aktuell.aworkProjectNumberFieldId ?? '',
        taskListName: aktuell.taskListName,
        taskTitlePrefix: aktuell.taskTitlePrefix,
        fallbackUserId: aktuell.fallbackUserId ?? '',
      });
      setError(null);

      // Die awork-Freifelder gibt es nur mit stehender Verbindung; ohne
      // Schlüssel bleibt die Auswahl eben leer, statt eine Fehlermeldung zu
      // zeigen, die niemanden weiterbringt.
      if (aktuell.hasApiKey) {
        setAworkFelder(await api.listAworkFields().catch(() => []));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Jede Änderung liefert den frischen Stand zurück – eine Quelle genügt. */
  const aendern = async (aktion: () => Promise<AworkSettingsDto>) => {
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

  const speichern = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const gespeichert = await api.updateAworkSettings({
        // Leeres Feld heißt „unverändert" – sonst löschte jedes Speichern den
        // hinterlegten Schlüssel, nur weil er nicht angezeigt wird.
        ...(form.apiKey ? { apiKey: form.apiKey } : {}),
        projectNumberFieldId: form.projectNumberFieldId || null,
        aworkProjectNumberFieldId: form.aworkProjectNumberFieldId || null,
        taskListName: form.taskListName,
        taskTitlePrefix: form.taskTitlePrefix,
        fallbackUserId: form.fallbackUserId || null,
      });
      setSettings(gespeichert);
      setForm((current) => ({ ...current, apiKey: '' }));
      setInfo(t('common.saved'));
      if (gespeichert.hasApiKey) setAworkFelder(await api.listAworkFields().catch(() => []));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const pruefen = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const ergebnis = await api.checkAwork(form.apiKey || undefined);
      setPruefung(ergebnis);
      // Der Test liefert die Freifelder gleich mit – er hat den Schlüssel in
      // der Hand, auch wenn er noch nicht gespeichert ist.
      if (ergebnis.ok) setAworkFelder(ergebnis.fields);
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return <div className="empty">{error ?? t('common.loading')}</div>;
  }

  return (
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        {t('awork.intro')}
      </p>

      {error ? <div className="notice notice--warn">{error}</div> : null}
      {info ? <div className="notice notice--ok">{info}</div> : null}

      <div className="card" style={{ padding: 20 }}>
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy}
            onChange={(event) =>
              void aendern(() => api.updateAworkSettings({ enabled: event.target.checked }))
            }
          />
          {t('awork.enable')}
        </label>
        <p className="hint">{t('awork.enableHint')}</p>

        {settings.lastError ? (
          <div className="notice notice--warn" style={{ marginTop: 12 }}>
            {t('awork.lastError', { error: settings.lastError })}
          </div>
        ) : null}
      </div>

      <form
        className="card"
        style={{ padding: 20 }}
        onSubmit={(event) => {
          event.preventDefault();
          void speichern();
        }}
      >
        <h2 className="section__title" style={{ marginTop: 0 }}>
          {t('awork.connectionTitle')}
        </h2>

        <div className="field">
          <label className="field__label" htmlFor="awork-key">
            {t('awork.apiKey')}
          </label>
          <input
            id="awork-key"
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder={settings.hasApiKey ? t('awork.apiKeyStored') : ''}
            value={form.apiKey}
            onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
          />
          <p className="hint">{t('awork.apiKeyHint')}</p>
        </div>

        <div className="toolbar" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className="button button--ghost"
            disabled={busy || (!settings.hasApiKey && !form.apiKey)}
            onClick={() => void pruefen()}
          >
            {t('awork.check')}
          </button>
          {pruefung ? (
            <span className={pruefung.ok ? 'faint' : 'notice notice--warn'} style={{ fontSize: 13 }}>
              {pruefung.message}
            </span>
          ) : settings.lastCheckAt ? (
            <span className="faint" style={{ fontSize: 12 }}>
              {t('awork.lastCheck', { when: formatDateTime(settings.lastCheckAt) })}
            </span>
          ) : null}
        </div>

        <h2 className="section__title">{t('awork.matchingTitle')}</h2>
        <p className="hint">{t('awork.matchingHint')}</p>

        <div className="grid-two">
          <div className="field">
            <label className="field__label" htmlFor="awork-klappe-feld">
              {t('awork.klappeField')}
            </label>
            <select
              id="awork-klappe-feld"
              className="select"
              value={form.projectNumberFieldId}
              onChange={(event) => setForm({ ...form, projectNumberFieldId: event.target.value })}
            >
              <option value="">{t('awork.fieldNone')}</option>
              {klappeFelder.map((feld) => (
                <option key={feld.id} value={feld.id}>
                  {feld.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="awork-awork-feld">
              {t('awork.aworkField')}
            </label>
            <select
              id="awork-awork-feld"
              className="select"
              value={form.aworkProjectNumberFieldId}
              onChange={(event) =>
                setForm({ ...form, aworkProjectNumberFieldId: event.target.value })
              }
            >
              <option value="">{t('awork.fieldNone')}</option>
              {aworkFelder.map((feld) => (
                <option key={feld.id} value={feld.id}>
                  {feld.name}
                </option>
              ))}
            </select>
            {aworkFelder.length === 0 ? <p className="hint">{t('awork.aworkFieldEmpty')}</p> : null}
          </div>
        </div>

        <h2 className="section__title">{t('awork.tasksTitle')}</h2>

        <div className="grid-two">
          <div className="field">
            <label className="field__label" htmlFor="awork-liste">
              {t('awork.taskList')}
            </label>
            <input
              id="awork-liste"
              className="input"
              value={form.taskListName}
              onChange={(event) => setForm({ ...form, taskListName: event.target.value })}
            />
            <p className="hint">{t('awork.taskListHint')}</p>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="awork-praefix">
              {t('awork.taskPrefix')}
            </label>
            <input
              id="awork-praefix"
              className="input"
              value={form.taskTitlePrefix}
              onChange={(event) => setForm({ ...form, taskTitlePrefix: event.target.value })}
            />
            <p className="hint">{t('awork.taskPrefixHint')}</p>
          </div>
        </div>

        <div className="toolbar" style={{ marginTop: 18 }}>
          <span className="faint" style={{ fontSize: 12 }}>
            {t('common.lastChanged', { when: formatDateTime(settings.updatedAt) })}
          </span>
          <div className="shell__spacer" />
          <button type="submit" className="button button--primary" disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      </form>

      <fieldset className="card abschnitt" style={{ padding: 20 }} disabled={!settings.enabled || busy}>
        <h2 className="section__title" style={{ marginTop: 0 }}>
          {t('awork.eventsTitle')}
        </h2>
        <p className="hint">{t('awork.eventsHint')}</p>

        <table className="table">
          <tbody>
            {settings.events.map((eintrag) => {
              const texte = EREIGNIS_TEXTE[eintrag.event];
              return (
                <tr key={eintrag.event}>
                  <td>
                    <strong>{t(texte.name)}</strong>
                    <div className="faint" style={{ fontSize: 12 }}>
                      {t(texte.hint)}
                    </div>
                  </td>
                  <td style={{ width: 120, textAlign: 'right' }}>
                    {eintrag.alwaysOn ? (
                      <span className="faint" style={{ fontSize: 12 }}>
                        {t('awork.always')}
                      </span>
                    ) : (
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={eintrag.enabled}
                          onChange={(event) =>
                            void aendern(() =>
                              api.updateAworkSettings({
                                events: [
                                  { event: eintrag.event, enabled: event.target.checked },
                                ],
                              }),
                            )
                          }
                        />
                      </label>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </fieldset>

      <fieldset className="card abschnitt" style={{ padding: 20 }} disabled={!settings.enabled || busy}>
        <h2 className="section__title" style={{ marginTop: 0 }}>
          {t('awork.backTitle')}
        </h2>
        <p className="hint">{t('awork.backHint')}</p>

        <label className="switch">
          <input
            type="checkbox"
            checked={settings.autoCreateProjects}
            onChange={(event) =>
              void aendern(() =>
                api.updateAworkSettings({ autoCreateProjects: event.target.checked }),
              )
            }
          />
          {t('awork.autoCreate')}
        </label>
        <p className="hint">{t('awork.autoCreateHint')}</p>

        <div className="field" style={{ maxWidth: 320 }}>
          <label className="field__label" htmlFor="awork-fallback">
            {t('awork.fallbackUser')}
          </label>
          <select
            id="awork-fallback"
            className="select"
            value={form.fallbackUserId}
            onChange={(event) => {
              const wert = event.target.value;
              setForm({ ...form, fallbackUserId: wert });
              void aendern(() => api.updateAworkSettings({ fallbackUserId: wert || null }));
            }}
          >
            <option value="">{t('awork.fallbackNone')}</option>
            {team.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <p className="hint">{t('awork.fallbackUserHint')}</p>
        </div>

        <label className="switch">
          <input
            type="checkbox"
            checked={settings.writeBackLink}
            onChange={(event) =>
              void aendern(() => api.updateAworkSettings({ writeBackLink: event.target.checked }))
            }
          />
          {t('awork.writeBackLink')}
        </label>
        <p className="hint">{t('awork.writeBackLinkHint')}</p>

        <label className="switch">
          <input
            type="checkbox"
            checked={settings.syncProjectNumber}
            onChange={(event) =>
              void aendern(() =>
                api.updateAworkSettings({ syncProjectNumber: event.target.checked }),
              )
            }
          />
          {t('awork.syncNumber')}
        </label>
        <p className="hint">{t('awork.syncNumberHint')}</p>
      </fieldset>
    </>
  );
}
