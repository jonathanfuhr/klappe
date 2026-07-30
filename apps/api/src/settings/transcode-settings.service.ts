import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_TRANSCODE_WINDOW_END,
  DEFAULT_TRANSCODE_WINDOW_START,
  HLS_MODES,
  RENDITION_CONTAINERS,
  TRANSCODE_TIMINGS,
  X264_PRESETS,
  type DownloadPresetDto,
  type HlsMode,
  type RenditionContainer,
  type TranscodeSettingsDto,
  type TranscodeTiming,
  type X264Preset,
} from '@klappe/shared';
import { asc, eq } from 'drizzle-orm';
import { uniqueViolation } from '../common/db-errors';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { appSettings, downloadPresets, type DownloadPresetRow } from '../db/schema';
import {
  formatMinute,
  isValidMinute,
  parseMinute,
  type TranscodeWindow,
} from '../transcode/transcode-window';

const SETTINGS_ID = 1;

/**
 * Was für einen Lauf tatsächlich gilt (Phase 19).
 *
 * Der Worker fragt das je Auftrag frisch ab, statt es beim Start einzulesen.
 * Deshalb wirkt eine Änderung in der Oberfläche ab dem nächsten Auftrag –
 * ohne Neustart des Containers.
 */
export interface EffectiveTranscode {
  downloadFormatsEnabled: boolean;
  downloadFinalOnly: boolean;
  downloadTiming: TranscodeTiming;
  /** Nur bei `downloadTiming === 'schedule'` befüllt. */
  downloadWindow: TranscodeWindow;
  hlsMode: HlsMode;
  /** Nur bei `hlsMode === 'schedule'` befüllt. */
  hlsWindow: TranscodeWindow;
  proxyShortEdge: number;
  /** Fertige ffmpeg-Angaben, damit die Umrechnung an einer Stelle steht. */
  proxyVideoBitrate: string;
  proxyMaxrate: string;
  proxyBufsize: string;
  proxyPreset: string;
}

export interface UpdateTranscodeInput {
  downloadFormatsEnabled?: boolean;
  downloadFinalOnly?: boolean;
  downloadTiming?: string;
  /** `HH:MM`; leerer String löscht das Fenster. */
  downloadWindowStart?: string | null;
  downloadWindowEnd?: string | null;
  hlsMode?: string;
  hlsWindowStart?: string | null;
  hlsWindowEnd?: string | null;
  proxyShortEdge?: number;
  proxyVideoBitrateKbps?: number;
  proxyPreset?: string;
}

export interface PresetInput {
  name: string;
  shortEdge: number;
  videoBitrateKbps: number;
  audioBitrateKbps?: number;
  preset?: string;
  container?: string;
  sortOrder?: number;
  isActive?: boolean;
}

/** Grenzen, die sowohl die Oberfläche als auch die API prüft. */
export const MIN_SHORT_EDGE = 144;
export const MAX_SHORT_EDGE = 4320;
export const MIN_BITRATE_KBPS = 100;
export const MAX_BITRATE_KBPS = 200_000;

/**
 * `10M`, `10000k`, `10000000` → 10000 kbit/s. `null`, wenn nichts Brauchbares
 * dasteht – dann bleibt der Aufrufer bei seinem eigenen Wert.
 */
export function parseBitrateKbps(text: string | null | undefined): number | null {
  if (!text) return null;
  const treffer = text.trim().match(/^(\d+(?:[.,]\d+)?)\s*([kKmM])?$/);
  if (!treffer) return null;
  const zahl = Number(treffer[1].replace(',', '.'));
  if (!Number.isFinite(zahl) || zahl <= 0) return null;
  const einheit = treffer[2]?.toLowerCase();
  if (einheit === 'm') return Math.round(zahl * 1000);
  if (einheit === 'k') return Math.round(zahl);
  // Ohne Einheit meint ffmpeg bit/s.
  return Math.round(zahl / 1000);
}

/**
 * Verarbeitungseinstellungen des Workspace.
 *
 * Alles, was früher nur in der `.env` stand, ist hier nullbar hinterlegt:
 * `null` heißt „in der Oberfläche nie entschieden – nimm den Wert aus dem
 * Container". So läuft eine bestehende Anlage unverändert weiter, und der
 * erste Klick übernimmt die Hoheit.
 */
@Injectable()
export class TranscodeSettingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Was gerade tatsächlich gilt – das liest der Worker je Auftrag. */
  async effective(): Promise<EffectiveTranscode> {
    const row = await this.getRow();
    const { transcode } = this.config;

    const bitrateKbps = row.proxyVideoBitrateKbps;
    const bitraten = bitrateKbps
      ? {
          // Kopfraum wie in den Voreinstellungen (10M/12M/24M): 1,2- und
          // 2,4-fach. So bleibt ein von Hand gesetzter Wert plausibel, ohne
          // dass drei Felder ausgefüllt werden müssen.
          proxyVideoBitrate: `${bitrateKbps}k`,
          proxyMaxrate: `${Math.round(bitrateKbps * 1.2)}k`,
          proxyBufsize: `${Math.round(bitrateKbps * 2.4)}k`,
        }
      : {
          proxyVideoBitrate: transcode.proxyVideoBitrate,
          proxyMaxrate: transcode.proxyMaxrate,
          proxyBufsize: transcode.proxyBufsize,
        };

    const hlsMode = toHlsMode(row.hlsMode, transcode.hlsEnabled);
    const downloadTiming = toTiming(row.downloadTiming);

    return {
      downloadFormatsEnabled: row.downloadFormatsEnabled,
      downloadFinalOnly: row.downloadFinalOnly,
      downloadTiming,
      // Ein Zeitplan ohne Uhrzeiten wäre ein Schalter, der nichts tut. Es
      // gilt dann die Vorbelegung 22:00–06:00, also genau das, was in der
      // Oberfläche danebensteht.
      downloadWindow:
        downloadTiming === 'schedule'
          ? fensterOderStandard(row.downloadWindowStart, row.downloadWindowEnd)
          : KEIN_FENSTER,
      hlsMode,
      hlsWindow:
        hlsMode === 'schedule'
          ? fensterOderStandard(row.hlsWindowStart, row.hlsWindowEnd)
          : KEIN_FENSTER,
      proxyShortEdge: row.proxyShortEdge ?? transcode.proxyShortEdge,
      ...bitraten,
      proxyPreset: row.proxyPreset ?? transcode.proxyPreset,
    };
  }

  async get(): Promise<TranscodeSettingsDto> {
    const row = await this.getRow();
    const { transcode } = this.config;
    const envBitrate = parseBitrateKbps(transcode.proxyVideoBitrate) ?? 10_000;

    return {
      downloadFormatsEnabled: row.downloadFormatsEnabled,
      downloadFinalOnly: row.downloadFinalOnly,
      downloadTiming: toTiming(row.downloadTiming),
      downloadWindowStart: formatMinute(row.downloadWindowStart),
      downloadWindowEnd: formatMinute(row.downloadWindowEnd),
      hlsMode: toHlsMode(row.hlsMode, transcode.hlsEnabled),
      hlsModeFromEnv: row.hlsMode === null,
      hlsWindowStart: formatMinute(row.hlsWindowStart),
      hlsWindowEnd: formatMinute(row.hlsWindowEnd),
      proxyShortEdge: row.proxyShortEdge ?? transcode.proxyShortEdge,
      proxyShortEdgeFromEnv: row.proxyShortEdge === null,
      proxyVideoBitrateKbps: row.proxyVideoBitrateKbps ?? envBitrate,
      proxyVideoBitrateFromEnv: row.proxyVideoBitrateKbps === null,
      proxyPreset: toX264Preset(row.proxyPreset ?? transcode.proxyPreset),
      proxyPresetFromEnv: row.proxyPreset === null,
      presets: await this.listPresets(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async update(input: UpdateTranscodeInput): Promise<TranscodeSettingsDto> {
    await this.getRow();

    const download = pruefeFenster(input.downloadWindowStart, input.downloadWindowEnd, 'Formate');
    const hls = pruefeFenster(input.hlsWindowStart, input.hlsWindowEnd, 'Stufenleiter');

    await this.db
      .update(appSettings)
      .set({
        downloadFormatsEnabled: input.downloadFormatsEnabled,
        downloadFinalOnly: input.downloadFinalOnly,
        downloadTiming: input.downloadTiming === undefined ? undefined : toTiming(input.downloadTiming),
        downloadWindowStart: download.start,
        downloadWindowEnd: download.ende,
        hlsMode: input.hlsMode === undefined ? undefined : toHlsMode(input.hlsMode, false),
        hlsWindowStart: hls.start,
        hlsWindowEnd: hls.ende,
        proxyShortEdge:
          input.proxyShortEdge === undefined
            ? undefined
            : klemme(input.proxyShortEdge, MIN_SHORT_EDGE, MAX_SHORT_EDGE),
        proxyVideoBitrateKbps:
          input.proxyVideoBitrateKbps === undefined
            ? undefined
            : klemme(input.proxyVideoBitrateKbps, MIN_BITRATE_KBPS, MAX_BITRATE_KBPS),
        proxyPreset: input.proxyPreset === undefined ? undefined : toX264Preset(input.proxyPreset),
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));

    return this.get();
  }

  // ---------- Formate ----------

  async listPresets(nurAktive = false): Promise<DownloadPresetDto[]> {
    const rows = await this.db
      .select()
      .from(downloadPresets)
      .orderBy(asc(downloadPresets.sortOrder), asc(downloadPresets.createdAt));
    return rows
      .filter((row) => (nurAktive ? row.isActive : true))
      .map((row) => toPresetDto(row));
  }

  async getPresetRow(id: string): Promise<DownloadPresetRow> {
    const [row] = await this.db
      .select()
      .from(downloadPresets)
      .where(eq(downloadPresets.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Dieses Format gibt es nicht (mehr).');
    return row;
  }

  async createPreset(input: PresetInput): Promise<DownloadPresetDto> {
    const werte = this.pruefe(input);
    try {
      const [row] = await this.db.insert(downloadPresets).values(werte).returning();
      return toPresetDto(row);
    } catch (error) {
      throw this.uebersetzeNamensfehler(error, werte.name);
    }
  }

  async updatePreset(id: string, input: Partial<PresetInput>): Promise<DownloadPresetDto> {
    await this.getPresetRow(id);
    const werte = this.pruefe(input, true);
    try {
      const [row] = await this.db
        .update(downloadPresets)
        .set({ ...werte, updatedAt: new Date() })
        .where(eq(downloadPresets.id, id))
        .returning();
      return toPresetDto(row);
    } catch (error) {
      throw this.uebersetzeNamensfehler(error, input.name ?? '');
    }
  }

  /**
   * Löschen nimmt die schon erzeugten Dateien mit (Fremdschlüssel mit
   * `on delete cascade`); die Dateien auf der Platte holt der tägliche
   * Aufräumer. Wer nur die Auswahl loswerden will, schaltet das Format
   * stattdessen aus.
   */
  async removePreset(id: string): Promise<void> {
    await this.getPresetRow(id);
    await this.db.delete(downloadPresets).where(eq(downloadPresets.id, id));
  }

  // ---------- Innereien ----------

  /** Liefert die eine Einstellungszeile und legt sie beim ersten Mal an. */
  private async getRow() {
    const [existing] = await this.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, SETTINGS_ID))
      .limit(1);
    if (existing) return existing;

    const [created] = await this.db
      .insert(appSettings)
      .values({ id: SETTINGS_ID })
      .onConflictDoNothing()
      .returning();
    if (created) return created;

    const [row] = await this.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, SETTINGS_ID))
      .limit(1);
    return row;
  }

  private pruefe(input: Partial<PresetInput>, teilweise = false) {
    const name = input.name?.trim();
    if (!teilweise && !name) throw new BadRequestException('Das Format braucht einen Namen.');
    if (input.name !== undefined && !name) {
      throw new BadRequestException('Das Format braucht einen Namen.');
    }

    if (input.shortEdge !== undefined && !Number.isFinite(input.shortEdge)) {
      throw new BadRequestException('Die kurze Kante ist keine Zahl.');
    }
    if (input.videoBitrateKbps !== undefined && !Number.isFinite(input.videoBitrateKbps)) {
      throw new BadRequestException('Die Bitrate ist keine Zahl.');
    }

    return {
      name,
      shortEdge:
        input.shortEdge === undefined
          ? undefined
          : klemme(input.shortEdge, MIN_SHORT_EDGE, MAX_SHORT_EDGE),
      videoBitrateKbps:
        input.videoBitrateKbps === undefined
          ? undefined
          : klemme(input.videoBitrateKbps, MIN_BITRATE_KBPS, MAX_BITRATE_KBPS),
      audioBitrateKbps:
        input.audioBitrateKbps === undefined
          ? undefined
          : klemme(input.audioBitrateKbps, 32, 512),
      preset: input.preset === undefined ? undefined : toX264Preset(input.preset),
      container: input.container === undefined ? undefined : toContainer(input.container),
      sortOrder: input.sortOrder === undefined ? undefined : Math.round(input.sortOrder),
      isActive: input.isActive,
    } as {
      name: string;
      shortEdge: number;
      videoBitrateKbps: number;
      audioBitrateKbps?: number;
      preset?: X264Preset;
      container?: RenditionContainer;
      sortOrder?: number;
      isActive?: boolean;
    };
  }

  /** Der eindeutige Index auf den Namen soll als Satz ankommen, nicht als SQL-Fehler. */
  private uebersetzeNamensfehler(error: unknown, name: string): unknown {
    if (uniqueViolation(error) !== null) {
      return new BadRequestException(`Ein Format namens „${name.trim()}“ gibt es schon.`);
    }
    return error;
  }
}

function klemme(wert: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(wert)));
}

const KEIN_FENSTER: TranscodeWindow = { startMinute: null, endMinute: null };

/**
 * Steht der Zeitplan auf „schedule", aber keine Uhrzeit dabei, gilt die
 * Vorbelegung aus der Oberfläche (22:00–06:00). Sonst wäre die Auswahl ein
 * Schalter ohne Wirkung – und niemand käme darauf, warum.
 */
function fensterOderStandard(start: number | null, ende: number | null): TranscodeWindow {
  if (isValidMinute(start) && isValidMinute(ende)) {
    return { startMinute: start, endMinute: ende };
  }
  return {
    startMinute: parseMinute(DEFAULT_TRANSCODE_WINDOW_START),
    endMinute: parseMinute(DEFAULT_TRANSCODE_WINDOW_END),
  };
}

/** `undefined` heißt unverändert, ein leerer String löscht die Uhrzeit. */
function pruefeFenster(
  start: string | null | undefined,
  ende: string | null | undefined,
  was: string,
): { start: number | null | undefined; ende: number | null | undefined } {
  const werte = {
    start: start === undefined ? undefined : parseMinute(start),
    ende: ende === undefined ? undefined : parseMinute(ende),
  };
  if (start && werte.start === null) {
    throw new BadRequestException(`Der Beginn des Zeitfensters (${was}) ist keine Uhrzeit (HH:MM).`);
  }
  if (ende && werte.ende === null) {
    throw new BadRequestException(`Das Ende des Zeitfensters (${was}) ist keine Uhrzeit (HH:MM).`);
  }
  return werte;
}

function toTiming(value: string | null | undefined): TranscodeTiming {
  return (TRANSCODE_TIMINGS as readonly string[]).includes(value ?? '')
    ? (value as TranscodeTiming)
    : 'on-demand';
}

/**
 * `null` in der Datenbank heißt „nie in der Oberfläche entschieden": Dann
 * entscheidet `HLS_ENABLED` aus der `.env`, ob die Leiter nach dem Upload
 * läuft oder gar nicht.
 */
function toHlsMode(value: string | null | undefined, envEnabled: boolean): HlsMode {
  if (value === null || value === undefined) return envEnabled ? 'upload' : 'off';
  return (HLS_MODES as readonly string[]).includes(value) ? (value as HlsMode) : 'off';
}

function toX264Preset(value: string): X264Preset {
  return (X264_PRESETS as readonly string[]).includes(value) ? (value as X264Preset) : 'veryfast';
}

function toContainer(value: string): RenditionContainer {
  return (RENDITION_CONTAINERS as readonly string[]).includes(value)
    ? (value as RenditionContainer)
    : 'mp4';
}

function toPresetDto(row: DownloadPresetRow): DownloadPresetDto {
  return {
    id: row.id,
    name: row.name,
    shortEdge: row.shortEdge,
    videoBitrateKbps: row.videoBitrateKbps,
    audioBitrateKbps: row.audioBitrateKbps,
    preset: toX264Preset(row.preset),
    container: toContainer(row.container),
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}
