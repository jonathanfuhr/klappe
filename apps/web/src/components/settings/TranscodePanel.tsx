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
import { type Translator, useT } from '@/lib/i18n';

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
  const t = useT();
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
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    }
  }, [uebernimm, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      uebernimm(await api.updateTranscodeSettings(form));
      setInfo(t('transcode.saved'));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('common.saveFailed'));
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
      setError(updateError instanceof Error ? updateError.message : t('common.changeFailed'));
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
      setError(createError instanceof Error ? createError.message : t('common.createFailed'));
    } finally {
      setBusy(false);
    }
  };

  const loesche = async (format: DownloadPresetDto) => {
    if (
      !window.confirm(t('transcode.deleteConfirm', { name: format.name }))
    ) {
      return;
    }
    setError(null);
    try {
      await api.deleteDownloadPreset(format.id);
      uebernimm(await api.getTranscodeSettings());
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t('common.deleteFailed'));
    }
  };

  if (!settings) {
    return <div className="empty">{error ?? t('common.loading')}</div>;
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
        {t('transcode.subtitle')}
      </p>

      {error ? <div className="notice">{error}</div> : null}
      {info ? (
        <div className="card" style={{ padding: '10px 12px' }}>
          {info}
        </div>
      ) : null}

      {/* ---------- Download-Formate ---------- */}
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px' }}>{t('transcode.downloadTitle')}</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {t('transcode.downloadHint')}
        </p>

        <label className="switch" style={{ marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={form.downloadFormatsEnabled}
            onChange={(event) =>
              setForm({ ...form, downloadFormatsEnabled: event.target.checked })
            }
          />
          {t('transcode.offerFormats')}
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
                  <th>{t('common.name')}</th>
                  <th>{t('transcode.colShortEdge')}</th>
                  <th>{t('transcode.colBitrate')}</th>
                  <th>{t('transcode.colQuality')}</th>
                  <th>{t('transcode.colContainer')}</th>
                  <th>{t('transcode.colOffered')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {settings.presets.map((format) => (
                  <tr key={format.id}>
                    <td data-label={t('common.name')}>
                      <input
                        className="input"
                        aria-label={t('transcode.formatNameLabel')}
                        defaultValue={format.name}
                        onKeyDown={beendeMitEingabe}
                        onBlur={(event) => {
                          const name = event.target.value.trim();
                          if (name && name !== format.name) void aendereFormat(format.id, { name });
                        }}
                      />
                    </td>
                    <td data-label={t('transcode.colShortEdge')}>
                      <input
                        className="input transcode__num"
                        type="number"
                        min={144}
                        max={4320}
                        aria-label={t('transcode.shortEdgeLabel')}
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
                    <td data-label={t('transcode.colBitrate')}>
                      <input
                        className="input transcode__num"
                        type="number"
                        min={100}
                        max={200000}
                        aria-label={t('transcode.bitrateLabel')}
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
                    <td data-label={t('transcode.colQuality')}>
                      <select
                        className="select"
                        aria-label={t('transcode.qualityLabel')}
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
                    <td data-label={t('transcode.colContainer')}>
                      <select
                        className="select"
                        aria-label={t('transcode.colContainer')}
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
                    <td data-label={t('transcode.colOffered')}>
                      <label className="switch">
                        <input
                          type="checkbox"
                          aria-label={t('transcode.offerThisFormat')}
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
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
                {settings.presets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="faint">
                      {t('transcode.noFormats')}
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
                    {t('common.name')}
                  </label>
                  <input
                    id="neu-name"
                    className="input"
                    placeholder={t('transcode.newNamePlaceholder')}
                    value={entwurf.name}
                    onChange={(event) => setEntwurf({ ...entwurf, name: event.target.value })}
                  />
                  <p className="hint">{t('transcode.newNameHint')}</p>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="neu-kante">
                    {t('transcode.colShortEdge')}
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
                    {t('transcode.shortEdgeHint')}
                  </p>
                </div>
              </div>

              <div className="grid-two">
                <div className="field">
                  <label className="field__label" htmlFor="neu-bitrate">
                    {t('transcode.videoBitrate')}
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
                    {t('transcode.audioBitrate')}
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
                    {t('transcode.colQuality')}
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
                    {t('transcode.presetHint')}
                  </p>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="neu-container">
                    {t('transcode.colContainer')}
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
                  {t('transcode.createFormat')}
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => {
                    setAnlegen(false);
                    setEntwurf({ ...NEUES_FORMAT });
                  }}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => setAnlegen(true)}
            >
              {t('transcode.addFormat')}
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
            {t('transcode.finalOnly')}
          </label>
          <p className="hint" style={{ margin: '0 0 16px 28px' }}>
            {t('transcode.finalOnlyHint')}
          </p>

          <div className="field" style={{ maxWidth: 420 }}>
            <label className="field__label" htmlFor="download-zeitplan">
              {t('transcode.whenDownload')}
            </label>
            <select
              id="download-zeitplan"
              className="select"
              value={form.downloadTiming}
              onChange={(event) => setzeZeitplan('download', event.target.value)}
            >
              <option value="on-demand">{t('transcode.timingOnDemand')}</option>
              <option value="upload">{t('transcode.timingUpload')}</option>
              <option value="schedule">{t('transcode.timingSchedule')}</option>
            </select>
            <p className="hint">{erklaerungDownload(form.downloadTiming, t)}</p>
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
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px' }}>{t('transcode.hlsTitle')}</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {t('transcode.hlsHint')}
        </p>

        <div className="field" style={{ maxWidth: 420 }}>
          <label className="field__label" htmlFor="hls-zeitplan">
            {t('transcode.whenHls')}
          </label>
          <select
            id="hls-zeitplan"
            className="select"
            value={form.hlsMode}
            onChange={(event) => setzeZeitplan('hls', event.target.value)}
          >
            <option value="off">{t('transcode.hlsOff')}</option>
            <option value="upload">{t('transcode.hlsUpload')}</option>
            <option value="schedule">{t('transcode.timingSchedule')}</option>
          </select>
          <p className="hint">{erklaerungHls(form.hlsMode, t)}</p>
        </div>

        {settings.hlsModeFromEnv ? (
          <p className="hint" style={{ marginTop: 0 }}>
            {t('transcode.fromEnvHint', { var: 'HLS_ENABLED', file: '.env' })}
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
      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px' }}>{t('transcode.proxyTitle')}</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {t('transcode.proxyHint')}
        </p>

        <div className="notice" style={{ marginBottom: 12 }}>
          {t('transcode.proxyWarn')}
        </div>

        <div className="grid-two">
          <div className="field">
            <label className="field__label" htmlFor="proxy-kante">
              {t('transcode.colShortEdge')}
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
              {t('transcode.videoBitrate')}
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
            {t('transcode.colQuality')}
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
          {t('common.save')}
        </button>
        <span className="faint" style={{ fontSize: 12 }}>
          {t('transcode.appliesNextJob')}
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
  const t = useT();
  return (
    <>
      <div className="grid-two" style={{ maxWidth: 420 }}>
        <div className="field">
          <label className="field__label" htmlFor={`${idPrefix}-fenster-von`}>
            {t('transcode.windowFrom')}
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
            {t('transcode.windowTo')}
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
        {t('transcode.windowHint')}
      </p>
      {unvollstaendig ? (
        <div className="notice" style={{ marginBottom: 12 }}>
          {t('transcode.windowIncomplete')}
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

/** Was die jeweilige Wahl bedeutet – ein Satz unter dem Auswahlfeld. */
function erklaerungDownload(wert: string, t: Translator): string {
  if (wert === 'on-demand') return t('transcode.downloadOnDemandHint');
  if (wert === 'upload') return t('transcode.downloadUploadHint');
  if (wert === 'schedule') return t('transcode.downloadScheduleHint');
  return '';
}

function erklaerungHls(wert: string, t: Translator): string {
  if (wert === 'off') return t('transcode.hlsOffHint');
  if (wert === 'upload') return t('transcode.hlsUploadHint');
  if (wert === 'schedule') return t('transcode.hlsScheduleHint');
  return '';
}
