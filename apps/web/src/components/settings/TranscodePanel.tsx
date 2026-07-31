'use client';

import {
  DEFAULT_TRANSCODE_WINDOW_END,
  DEFAULT_TRANSCODE_WINDOW_START,
  RENDITION_CONTAINERS,
  X264_PRESETS,
  type DownloadPresetDto,
  type TranscodeSettingsDto,
} from '@klappe/shared';
import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import { api } from '@/lib/api';

/** Leerer Entwurf für ein neues Format. */
const NEUES_FORMAT = {
  name: '',
  shortEdge: 1080,
  videoBitrateKbps: 10_000,
  audioBitrateKbps: 192,
  preset: 'veryfast' as string,
  container: 'mp4' as string,
};

/**
 * Verarbeitung (Phase 19, neu gegliedert in Phase 20).
 *
 * Drei Abschnitte, die drei verschiedene Dinge betreffen: die Formate zum
 * Herunterladen, die adaptive Stufenleiter und die Abspielfassung. Jeder
 * bringt seinen eigenen Zeitplan mit.
 *
 * Vorher stand „Wann gerechnet wird" als eigener Block dazwischen und galt
 * für zwei der drei zugleich – wofür genau, musste man raten. Dazu ein Haken
 * „direkt beim Upload erstellen", der sich mit dem Zeitfenster daneben
 * widersprechen konnte. Beides ist jetzt je eine Auswahl aus sich
 * ausschließenden Möglichkeiten, dort, wo sie hingehört.
 *
 * Gelesen wird das vor jedem Auftrag frisch aus der Datenbank – eine Änderung
 * greift also ab dem nächsten Video, ohne dass der Container neu startet.
 */
export function TranscodePanel() {
  const [settings, setSettings] = useState<TranscodeSettingsDto | null>(null);
  const [form, setForm] = useState({
    downloadFormatsEnabled: false,
    downloadFinalOnly: false,
    downloadTiming: 'on-demand' as string,
    downloadWindowStart: '',
    downloadWindowEnd: '',
    hlsMode: 'off' as string,
    hlsWindowStart: '',
    hlsWindowEnd: '',
    proxyShortEdge: 1080,
    proxyVideoBitrateKbps: 10_000,
    proxyPreset: 'veryfast' as string,
  });
  const [entwurf, setEntwurf] = useState({ ...NEUES_FORMAT });
  const [anlegen, setAnlegen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const uebernimm = useCallback((geladen: TranscodeSettingsDto) => {
    setSettings(geladen);
    setForm({
      downloadFormatsEnabled: geladen.downloadFormatsEnabled,
      downloadFinalOnly: geladen.downloadFinalOnly,
      downloadTiming: geladen.downloadTiming,
      downloadWindowStart: geladen.downloadWindowStart ?? '',
      downloadWindowEnd: geladen.downloadWindowEnd ?? '',
      hlsMode: geladen.hlsMode,
      hlsWindowStart: geladen.hlsWindowStart ?? '',
      hlsWindowEnd: geladen.hlsWindowEnd ?? '',
      proxyShortEdge: geladen.proxyShortEdge,
      proxyVideoBitrateKbps: geladen.proxyVideoBitrateKbps,
      proxyPreset: geladen.proxyPreset,
    });
  }, []);

  const load = useCallback(async () => {
    try {
      uebernimm(await api.getTranscodeSettings());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    }
  }, [uebernimm]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      uebernimm(await api.updateTranscodeSettings(form));
      setInfo('Gespeichert. Wirkt ab dem nächsten Auftrag – kein Neustart nötig.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const aendereFormat = async (id: string, changes: Partial<DownloadPresetDto>) => {
    setError(null);
    try {
      await api.updateDownloadPreset(id, changes);
      uebernimm(await api.getTranscodeSettings());
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Ändern fehlgeschlagen.');
    }
  };

  const legeAn = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createDownloadPreset(entwurf);
      uebernimm(await api.getTranscodeSettings());
      setEntwurf({ ...NEUES_FORMAT });
      setAnlegen(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Anlegen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const loesche = async (format: DownloadPresetDto) => {
    if (
      !window.confirm(
        `„${format.name}“ löschen?\n\n` +
          'Schon erzeugte Dateien dieses Formats werden mit entfernt. ' +
          'Wer das Format nur aus der Auswahl nehmen will, schaltet es stattdessen aus.',
      )
    ) {
      return;
    }
    setError(null);
    try {
      await api.deleteDownloadPreset(format.id);
      uebernimm(await api.getTranscodeSettings());
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Löschen fehlgeschlagen.');
    }
  };

  if (!settings) {
    return <div className="empty">{error ?? 'Wird geladen …'}</div>;
  }

  /**
   * Wer „nach Zeitplan" wählt, bekommt gleich Uhrzeiten vorgelegt. Ein
   * Zeitplan ohne Zeiten wäre eine Auswahl, die nichts tut.
   */
  const setzeZeitplan = (feld: 'download' | 'hls', wert: string) => {
    const plan = wert === 'schedule';
    if (feld === 'download') {
      setForm({
        ...form,
        downloadTiming: wert,
        downloadWindowStart:
          plan && !form.downloadWindowStart
            ? DEFAULT_TRANSCODE_WINDOW_START
            : form.downloadWindowStart,
        downloadWindowEnd:
          plan && !form.downloadWindowEnd ? DEFAULT_TRANSCODE_WINDOW_END : form.downloadWindowEnd,
      });
      return;
    }
    setForm({
      ...form,
      hlsMode: wert,
      hlsWindowStart:
        plan && !form.hlsWindowStart ? DEFAULT_TRANSCODE_WINDOW_START : form.hlsWindowStart,
      hlsWindowEnd: plan && !form.hlsWindowEnd ? DEFAULT_TRANSCODE_WINDOW_END : form.hlsWindowEnd,
    });
  };

  const downloadFensterUnvollstaendig =
    form.downloadTiming === 'schedule' &&
    Boolean(form.downloadWindowStart) !== Boolean(form.downloadWindowEnd);
  const hlsFensterUnvollstaendig =
    form.hlsMode === 'schedule' && Boolean(form.hlsWindowStart) !== Boolean(form.hlsWindowEnd);
  const unvollstaendig = downloadFensterUnvollstaendig || hlsFensterUnvollstaendig;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        Was der Server nach dem Hochladen erzeugt: die Formate zum Herunterladen, wahlweise eine
        adaptive Stufenleiter und die Abspielfassung, die jeder im Browser zu sehen bekommt.
      </p>

      {error ? <div className="notice">{error}</div> : null}
      {info ? (
        <div className="card" style={{ padding: '10px 12px', marginBottom: 14 }}>
          {info}
        </div>
      ) : null}

      {/* ---------- Download-Formate ---------- */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 4px' }}>Download in verschiedenen Formaten</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Ist das eingeschaltet, öffnet der Herunterladen-Knopf ein Fenster mit dieser Auswahl.
          Fehlt eine Fassung noch, entsteht sie beim Klick – mit Fortschrittsbalken. Das Original
          steht dort immer an erster Stelle.
        </p>

        <label className="switch" style={{ marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={form.downloadFormatsEnabled}
            onChange={(event) =>
              setForm({ ...form, downloadFormatsEnabled: event.target.checked })
            }
          />
          Formatauswahl anbieten
        </label>

        {/* Aus heißt: der ganze Abschnitt ist stumpf. `fieldset[disabled]`
            sperrt alles darin von selbst – kein Haken einzeln. */}
        <fieldset className="abschnitt" disabled={!form.downloadFormatsEnabled}>
          {/*
           * `table--cards`: Auf schmalen Schirmen wird aus jeder Zeile eine
           * Karte mit beschrifteten Feldern (Phase 24). Sieben Spalten mit
           * Eingabefeldern passen auf kein Handy – der seitliche Rollbereich
           * schnitt „Name" und „Qualität" schlicht ab, und dass dort überhaupt
           * noch etwas kam, war nicht zu sehen.
           */}
          <div className="tablewrap">
            <table className="table table--cards" style={{ marginBottom: 12 }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Kurze Kante</th>
                  <th>Bitrate</th>
                  <th>Qualität</th>
                  <th>Container</th>
                  <th>Angeboten</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {settings.presets.map((format) => (
                  <tr key={format.id}>
                    <td data-label="Name">
                      <input
                        className="input"
                        aria-label="Name des Formats"
                        defaultValue={format.name}
                        onKeyDown={beendeMitEingabe}
                        onBlur={(event) => {
                          const name = event.target.value.trim();
                          if (name && name !== format.name) void aendereFormat(format.id, { name });
                        }}
                      />
                    </td>
                    <td data-label="Kurze Kante">
                      <input
                        className="input transcode__num"
                        type="number"
                        min={144}
                        max={4320}
                        aria-label="Kurze Kante in Pixeln"
                        defaultValue={format.shortEdge}
                        onKeyDown={beendeMitEingabe}
                        onBlur={(event) => {
                          const shortEdge = Number(event.target.value);
                          if (shortEdge && shortEdge !== format.shortEdge) {
                            void aendereFormat(format.id, { shortEdge });
                          }
                        }}
                      />
                    </td>
                    <td data-label="Bitrate">
                      <input
                        className="input transcode__num"
                        type="number"
                        min={100}
                        max={200000}
                        aria-label="Bitrate in kbit/s"
                        defaultValue={format.videoBitrateKbps}
                        onKeyDown={beendeMitEingabe}
                        onBlur={(event) => {
                          const videoBitrateKbps = Number(event.target.value);
                          if (videoBitrateKbps && videoBitrateKbps !== format.videoBitrateKbps) {
                            void aendereFormat(format.id, { videoBitrateKbps });
                          }
                        }}
                      />
                      <span className="faint" style={{ marginLeft: 6, fontSize: 12 }}>
                        kbit/s
                      </span>
                    </td>
                    <td data-label="Qualität">
                      <select
                        className="select"
                        aria-label="Qualitätsstufe"
                        value={format.preset}
                        onChange={(event) =>
                          void aendereFormat(format.id, {
                            preset: event.target.value as DownloadPresetDto['preset'],
                          })
                        }
                      >
                        {X264_PRESETS.map((eintrag) => (
                          <option key={eintrag} value={eintrag}>
                            {eintrag}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Container">
                      <select
                        className="select"
                        aria-label="Container"
                        value={format.container}
                        onChange={(event) =>
                          void aendereFormat(format.id, {
                            container: event.target.value as DownloadPresetDto['container'],
                          })
                        }
                      >
                        {RENDITION_CONTAINERS.map((eintrag) => (
                          <option key={eintrag} value={eintrag}>
                            .{eintrag}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Angeboten">
                      <label className="switch">
                        <input
                          type="checkbox"
                          aria-label="Dieses Format anbieten"
                          checked={format.isActive}
                          onChange={(event) =>
                            void aendereFormat(format.id, { isActive: event.target.checked })
                          }
                        />
                      </label>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => void loesche(format)}
                      >
                        Löschen
                      </button>
                    </td>
                  </tr>
                ))}
                {settings.presets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="faint">
                      Noch kein Format angelegt.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {anlegen ? (
            <div className="card" style={{ padding: 16 }}>
              <div className="grid-two">
                <div className="field">
                  <label className="field__label" htmlFor="neu-name">
                    Name
                  </label>
                  <input
                    id="neu-name"
                    className="input"
                    placeholder="z. B. 720p – Vorschau"
                    value={entwurf.name}
                    onChange={(event) => setEntwurf({ ...entwurf, name: event.target.value })}
                  />
                  <p className="hint">Diesen Namen sieht der Kunde im Download-Fenster.</p>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="neu-kante">
                    Kurze Kante
                  </label>
                  <input
                    id="neu-kante"
                    className="input"
                    type="number"
                    min={144}
                    max={4320}
                    value={entwurf.shortEdge}
                    onChange={(event) =>
                      setEntwurf({ ...entwurf, shortEdge: Number(event.target.value) })
                    }
                  />
                  <p className="hint">
                    1080 heißt quer 1920×1080 und hoch 1080×1920. Vergrößert wird nie.
                  </p>
                </div>
              </div>

              <div className="grid-two">
                <div className="field">
                  <label className="field__label" htmlFor="neu-bitrate">
                    Video-Bitrate (kbit/s)
                  </label>
                  <input
                    id="neu-bitrate"
                    className="input"
                    type="number"
                    min={100}
                    max={200000}
                    value={entwurf.videoBitrateKbps}
                    onChange={(event) =>
                      setEntwurf({ ...entwurf, videoBitrateKbps: Number(event.target.value) })
                    }
                  />
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="neu-ton">
                    Ton-Bitrate (kbit/s)
                  </label>
                  <input
                    id="neu-ton"
                    className="input"
                    type="number"
                    min={32}
                    max={512}
                    value={entwurf.audioBitrateKbps}
                    onChange={(event) =>
                      setEntwurf({ ...entwurf, audioBitrateKbps: Number(event.target.value) })
                    }
                  />
                </div>
              </div>

              <div className="grid-two">
                <div className="field">
                  <label className="field__label" htmlFor="neu-preset">
                    Qualität
                  </label>
                  <select
                    id="neu-preset"
                    className="select"
                    value={entwurf.preset}
                    onChange={(event) => setEntwurf({ ...entwurf, preset: event.target.value })}
                  >
                    {X264_PRESETS.map((eintrag) => (
                      <option key={eintrag} value={eintrag}>
                        {eintrag}
                      </option>
                    ))}
                  </select>
                  <p className="hint">
                    Langsamer heißt kleinere Datei bei gleichem Bild – und mehr Rechenzeit.
                  </p>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="neu-container">
                    Container
                  </label>
                  <select
                    id="neu-container"
                    className="select"
                    value={entwurf.container}
                    onChange={(event) => setEntwurf({ ...entwurf, container: event.target.value })}
                  >
                    {RENDITION_CONTAINERS.map((eintrag) => (
                      <option key={eintrag} value={eintrag}>
                        .{eintrag}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="toolbar">
                <button
                  type="button"
                  className="button"
                  disabled={busy || !entwurf.name.trim()}
                  onClick={() => void legeAn()}
                >
                  Format anlegen
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => {
                    setAnlegen(false);
                    setEntwurf({ ...NEUES_FORMAT });
                  }}
                >
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setAnlegen(true)}
            >
              Format hinzufügen …
            </button>
          )}

          {/* `display: flex` statt des inline-flex aus `.switch`: Sonst rückt
              der Haken neben den „Format hinzufügen“-Knopf in dieselbe Zeile
              und klebt halb an ihm (Phase 22). */}
          <label className="switch" style={{ display: 'flex', margin: '18px 0 6px' }}>
            <input
              type="checkbox"
              checked={form.downloadFinalOnly}
              onChange={(event) => setForm({ ...form, downloadFinalOnly: event.target.checked })}
            />
            Verschiedene Formate nur für Endfassungen anbieten
          </label>
          <p className="hint" style={{ margin: '0 0 16px 28px' }}>
            An Zwischenständen bleibt es dann beim Original. Wird der Endfassungs-Haken später
            gesetzt, geht es genau dann los.
          </p>

          <div className="field" style={{ maxWidth: 420 }}>
            <label className="field__label" htmlFor="download-zeitplan">
              Wann sollen die Formate gerechnet werden?
            </label>
            <select
              id="download-zeitplan"
              className="select"
              value={form.downloadTiming}
              onChange={(event) => setzeZeitplan('download', event.target.value)}
            >
              <option value="on-demand">Erst beim Download</option>
              <option value="upload">Direkt beim Upload</option>
              <option value="schedule">Nach Zeitplan</option>
            </select>
            <p className="hint">{ERKLAERUNG_DOWNLOAD[form.downloadTiming] ?? ''}</p>
          </div>

          {form.downloadTiming === 'schedule' ? (
            <Zeitfenster
              idPrefix="download"
              von={form.downloadWindowStart}
              bis={form.downloadWindowEnd}
              unvollstaendig={downloadFensterUnvollstaendig}
              onVon={(wert) => setForm({ ...form, downloadWindowStart: wert })}
              onBis={(wert) => setForm({ ...form, downloadWindowEnd: wert })}
            />
          ) : null}
        </fieldset>
      </div>

      {/* ---------- Adaptive Wiedergabe ---------- */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 4px' }}>Adaptive Wiedergabe (HLS)</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Eine Stufenleiter aus 2160p/1080p/720p/480p, aus der der Player je nach Leitung wählt.
          Sie kostet einen zweiten vollen Durchlauf über das Original und entsteht deshalb als
          Nacharbeit – die Fassung ist vorher schon abspielbar, der Proxy genügt dafür.
        </p>

        <div className="field" style={{ maxWidth: 420 }}>
          <label className="field__label" htmlFor="hls-zeitplan">
            Wann soll die Stufenleiter gerechnet werden?
          </label>
          <select
            id="hls-zeitplan"
            className="select"
            value={form.hlsMode}
            onChange={(event) => setzeZeitplan('hls', event.target.value)}
          >
            <option value="off">Nicht rechnen</option>
            <option value="upload">Direkt nach dem Upload</option>
            <option value="schedule">Nach Zeitplan</option>
          </select>
          <p className="hint">{ERKLAERUNG_HLS[form.hlsMode] ?? ''}</p>
        </div>

        {settings.hlsModeFromEnv ? (
          <p className="hint" style={{ marginTop: 0 }}>
            Steht gerade auf dem Wert aus <code>HLS_ENABLED</code> in der <code>.env</code>. Sobald
            hier gespeichert wird, gilt diese Einstellung.
          </p>
        ) : null}

        {form.hlsMode === 'schedule' ? (
          <Zeitfenster
            idPrefix="hls"
            von={form.hlsWindowStart}
            bis={form.hlsWindowEnd}
            unvollstaendig={hlsFensterUnvollstaendig}
            onVon={(wert) => setForm({ ...form, hlsWindowStart: wert })}
            onBis={(wert) => setForm({ ...form, hlsWindowEnd: wert })}
          />
        ) : null}
      </div>

      {/* ---------- Abspielfassung ---------- */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 4px' }}>Abspielfassung</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Der 1080p-Proxy, den jeder im Browser zu sehen bekommt. Er entsteht immer sofort nach dem
          Hochladen und hat vor aller Nacharbeit Vorrang – deshalb steht hier kein Zeitplan.
        </p>

        <div className="notice" style={{ marginBottom: 12 }}>
          Diese Werte am besten so lassen. Sie bestimmen, was jeder im Browser zu sehen bekommt –
          und was bereits verarbeitet wurde, ändert sich rückwirkend nicht mit.
        </div>

        <div className="grid-two">
          <div className="field">
            <label className="field__label" htmlFor="proxy-kante">
              Kurze Kante
            </label>
            <input
              id="proxy-kante"
              className="input"
              type="number"
              min={144}
              max={4320}
              value={form.proxyShortEdge}
              onChange={(event) => setForm({ ...form, proxyShortEdge: Number(event.target.value) })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="proxy-bitrate">
              Video-Bitrate (kbit/s)
            </label>
            <input
              id="proxy-bitrate"
              className="input"
              type="number"
              min={100}
              max={200000}
              value={form.proxyVideoBitrateKbps}
              onChange={(event) =>
                setForm({ ...form, proxyVideoBitrateKbps: Number(event.target.value) })
              }
            />
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="proxy-preset">
            Qualität
          </label>
          <select
            id="proxy-preset"
            className="select"
            value={form.proxyPreset}
            onChange={(event) => setForm({ ...form, proxyPreset: event.target.value })}
          >
            {X264_PRESETS.map((eintrag) => (
              <option key={eintrag} value={eintrag}>
                {eintrag}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: 8 }}>
        <button type="submit" className="button" disabled={busy || unvollstaendig}>
          Speichern
        </button>
        <span className="faint" style={{ fontSize: 12 }}>
          Änderungen greifen ab dem nächsten Auftrag – ein Neustart ist nicht nötig.
        </span>
      </div>
    </form>
  );
}

/** Die Zeilen unter den Formaten und unter der Stufenleiter sind dieselben. */
function Zeitfenster({
  idPrefix,
  von,
  bis,
  unvollstaendig,
  onVon,
  onBis,
}: {
  idPrefix: string;
  von: string;
  bis: string;
  unvollstaendig: boolean;
  onVon: (wert: string) => void;
  onBis: (wert: string) => void;
}) {
  return (
    <>
      <div className="grid-two" style={{ maxWidth: 420 }}>
        <div className="field">
          <label className="field__label" htmlFor={`${idPrefix}-fenster-von`}>
            Ab
          </label>
          <input
            id={`${idPrefix}-fenster-von`}
            className="input"
            type="time"
            value={von}
            onChange={(event) => onVon(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${idPrefix}-fenster-bis`}>
            bis
          </label>
          <input
            id={`${idPrefix}-fenster-bis`}
            className="input"
            type="time"
            value={bis}
            onChange={(event) => onBis(event.target.value)}
          />
        </div>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Ein Beginn hinter dem Ende meint die Nacht, etwa 22:00 bis 06:00. Gerechnet wird in der
        Ortszeit des Containers.
      </p>
      {unvollstaendig ? (
        <div className="notice" style={{ marginBottom: 12 }}>
          Beide Zeiten angeben – oder beide leer lassen.
        </div>
      ) : null}
    </>
  );
}

/**
 * In der Tabelle wird ein Feld beim Verlassen gespeichert. Ohne das hier
 * würde die Eingabetaste stattdessen das umgebende Formular abschicken.
 */
function beendeMitEingabe(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.currentTarget.blur();
  }
}

const ERKLAERUNG_DOWNLOAD: Record<string, string> = {
  'on-demand':
    'Nichts entsteht im Voraus. Wer ein Format anfordert, wartet einmal darauf – danach liegt es bereit.',
  upload:
    'Die Formate entstehen gleich nach dem Hochladen, der Download geht später ohne Wartezeit los. Die Abspielfassung behält immer Vorrang.',
  schedule:
    'Die Formate entstehen erst im Zeitfenster – für Anlagen, auf denen tagsüber gearbeitet wird. Ein ausdrücklich angefordertes Format läuft trotzdem sofort.',
};

const ERKLAERUNG_HLS: Record<string, string> = {
  off: 'Der Player nimmt die Abspielfassung. Für die meisten Anlagen genügt das.',
  upload: 'Die Stufenleiter entsteht als Nacharbeit, sobald die Abspielfassung steht.',
  schedule:
    'Die Stufenleiter entsteht erst im Zeitfenster. Bis dahin spielt der Player die Abspielfassung – zu sehen ist der Unterschied nur bei schmaler Leitung.',
};
