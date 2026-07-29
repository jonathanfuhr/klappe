'use client';

import {
  RENDITION_CONTAINERS,
  X264_PRESETS,
  type DownloadPresetDto,
  type TranscodeSettingsDto,
} from '@klappe/shared';
import { useCallback, useEffect, useState } from 'react';
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
 * Verarbeitung (Phase 19).
 *
 * Alles, was früher nur in der `.env` stand: die Formate zum Herunterladen,
 * die adaptive Wiedergabe und die Werte der Abspielfassung. Gelesen wird das
 * vor jedem Auftrag frisch aus der Datenbank – eine Änderung greift also ab
 * dem nächsten Video, ohne dass der Container neu startet.
 */
export function TranscodePanel() {
  const [settings, setSettings] = useState<TranscodeSettingsDto | null>(null);
  const [form, setForm] = useState({
    downloadFormatsEnabled: false,
    downloadPrebuild: false,
    downloadFinalOnly: false,
    windowStart: '',
    windowEnd: '',
    hlsEnabled: false,
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
      downloadPrebuild: geladen.downloadPrebuild,
      downloadFinalOnly: geladen.downloadFinalOnly,
      windowStart: geladen.windowStart ?? '',
      windowEnd: geladen.windowEnd ?? '',
      hlsEnabled: geladen.hlsEnabled,
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

  const fensterUnvollstaendig = Boolean(form.windowStart) !== Boolean(form.windowEnd);

  return (
    <>
      <p className="page__subtitle" style={{ marginTop: 0 }}>
        Was der Server nach dem Hochladen erzeugt: die Abspielfassung, wahlweise eine adaptive
        Stufenleiter und die Formate, die beim Herunterladen zur Auswahl stehen.
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

        <table className="table" style={{ marginBottom: 12 }}>
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
                <td>
                  <input
                    className="input"
                    defaultValue={format.name}
                    onBlur={(event) => {
                      const name = event.target.value.trim();
                      if (name && name !== format.name) void aendereFormat(format.id, { name });
                    }}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={144}
                    max={4320}
                    style={{ width: 100 }}
                    defaultValue={format.shortEdge}
                    onBlur={(event) => {
                      const shortEdge = Number(event.target.value);
                      if (shortEdge && shortEdge !== format.shortEdge) {
                        void aendereFormat(format.id, { shortEdge });
                      }
                    }}
                  />
                </td>
                <td>
                  <input
                    className="input"
                    type="number"
                    min={100}
                    max={200000}
                    style={{ width: 110 }}
                    defaultValue={format.videoBitrateKbps}
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
                <td>
                  <select
                    className="select"
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
                <td>
                  <select
                    className="select"
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
                <td>
                  <label className="switch">
                    <input
                      type="checkbox"
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
          <button type="button" className="button button--ghost" onClick={() => setAnlegen(true)}>
            Format hinzufügen …
          </button>
        )}
      </div>

      {/* ---------- Wann und wofür gearbeitet wird ---------- */}
      <form
        className="card"
        style={{ padding: 20, marginBottom: 16 }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h3 style={{ margin: '0 0 4px' }}>Wann gerechnet wird</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Betrifft nur, worauf niemand wartet: die Vorab-Erzeugung und die adaptive Stufenleiter.
          Die Abspielfassung nach dem Hochladen und ein angefordertes Format laufen immer sofort –
          sonst stünde der Kunde acht Stunden vor einem leeren Fortschrittsbalken.
        </p>

        <label className="switch" style={{ marginBottom: 10 }}>
          <input
            type="checkbox"
            checked={form.downloadPrebuild}
            onChange={(event) => setForm({ ...form, downloadPrebuild: event.target.checked })}
          />
          Kleinere Fassungen direkt beim Upload erstellen
        </label>
        <p className="hint" style={{ margin: '0 0 14px 28px' }}>
          Der Download geht dann ohne Wartezeit los. Die Abspielfassung behält immer Vorrang – die
          Formate rücken in der Warteschlange nach hinten.
        </p>

        <label className="switch" style={{ marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={form.downloadFinalOnly}
            disabled={!form.downloadPrebuild}
            onChange={(event) => setForm({ ...form, downloadFinalOnly: event.target.checked })}
          />
          Nur für Endfassungen
        </label>

        <div className="grid-two">
          <div className="field">
            <label className="field__label" htmlFor="fenster-von">
              Zeitfenster ab
            </label>
            <input
              id="fenster-von"
              className="input"
              type="time"
              value={form.windowStart}
              onChange={(event) => setForm({ ...form, windowStart: event.target.value })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="fenster-bis">
              bis
            </label>
            <input
              id="fenster-bis"
              className="input"
              type="time"
              value={form.windowEnd}
              onChange={(event) => setForm({ ...form, windowEnd: event.target.value })}
            />
          </div>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          Beide leer heißt: jederzeit. Ein Beginn hinter dem Ende meint die Nacht, etwa 22:00 bis
          06:00. Gerechnet wird in der Ortszeit des Containers.
        </p>
        {fensterUnvollstaendig ? (
          <div className="notice" style={{ marginBottom: 12 }}>
            Beide Zeiten angeben – oder beide leer lassen.
          </div>
        ) : null}

        <h3 style={{ margin: '18px 0 4px' }}>Adaptive Wiedergabe (HLS)</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          Eine Stufenleiter aus 2160p/1080p/720p/480p, aus der der Player je nach Leitung wählt.
          Sie kostet einen zweiten vollen Durchlauf über das Original und entsteht deshalb als
          Nacharbeit – die Fassung ist vorher schon abspielbar.
        </p>
        <label className="switch" style={{ marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={form.hlsEnabled}
            onChange={(event) => setForm({ ...form, hlsEnabled: event.target.checked })}
          />
          Stufenleiter erzeugen
        </label>
        {settings.hlsFromEnv ? (
          <p className="hint" style={{ margin: '0 0 12px 28px' }}>
            Steht gerade auf dem Wert aus <code>HLS_ENABLED</code> in der <code>.env</code>. Sobald
            hier gespeichert wird, gilt diese Einstellung.
          </p>
        ) : null}

        <h3 style={{ margin: '18px 0 4px' }}>Abspielfassung</h3>
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
              onChange={(event) =>
                setForm({ ...form, proxyShortEdge: Number(event.target.value) })
              }
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

        <div className="toolbar" style={{ marginTop: 8 }}>
          <button type="submit" className="button" disabled={busy || fensterUnvollstaendig}>
            Speichern
          </button>
          <span className="faint" style={{ fontSize: 12 }}>
            Änderungen greifen ab dem nächsten Auftrag – ein Neustart ist nicht nötig.
          </span>
        </div>
      </form>
    </>
  );
}
