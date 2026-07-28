/**
 * Wie wird eine Datei fürs Abspielen aufbereitet, wie groß wird der Proxy,
 * und wie sieht der Sprite-Streifen für die Timeline aus? Reine Rechnerei,
 * damit sie ohne laufendes ffmpeg prüfbar ist.
 */
import type { FrameRate } from '@klappe/shared';

/** H.264 verlangt gerade Kantenlängen (yuv420p), deshalb wird immer gerundet. */
function toEven(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export interface ProxyScale {
  width: number;
  height: number;
  /** `false`, wenn das Original bereits klein genug ist. */
  scaled: boolean;
}

/**
 * Skaliert auf die **kurze Kante** – nicht auf die Höhe.
 *
 * Ein Hochformat-Video ist 1080×1920, kein 1920×1080. Würde man auf die Höhe
 * skalieren, bekäme ein Hochformat-Clip einen 1080 hohen Proxy mit 608 Pixel
 * Breite: unnötig klein. Die kurze Kante ist das Maß, das für Quer-, Hoch-
 * und Quadratformat gleichermaßen passt. Vergrößert wird nie.
 */
export function planProxyScale(
  sourceWidth: number,
  sourceHeight: number,
  maxShortEdge: number,
): ProxyScale {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError('Ungültige Quellauflösung.');
  }

  const shortEdge = Math.min(sourceWidth, sourceHeight);
  if (shortEdge <= maxShortEdge) {
    return { width: toEven(sourceWidth), height: toEven(sourceHeight), scaled: false };
  }

  const factor = maxShortEdge / shortEdge;
  return {
    width: toEven(sourceWidth * factor),
    height: toEven(sourceHeight * factor),
    scaled: true,
  };
}

/** Wie das Material fürs Abspielen bereitgestellt wird. */
export type PlaybackMode =
  /** Das Original taugt direkt – es wird nichts angefasst. */
  | 'ORIGINAL'
  /** Bild und Ton bleiben unangetastet, nur der Container wird neu gepackt. */
  | 'REMUX'
  /** Vollständig neu kodiert. */
  | 'TRANSCODE';

export interface PlaybackDecision {
  mode: PlaybackMode;
  /** Für die Oberfläche und das Protokoll nachvollziehbar. */
  reason: string;
}

export interface PlaybackCandidate {
  videoCodec: string | null;
  audioCodec: string | null;
  pixelFormat: string | null;
  formatName: string | null;
  width: number | null;
  height: number | null;
  bitrateBps: number | null;
  /** Steht der Index schon vorn? (siehe `mp4-faststart.ts`) */
  fastStart: boolean;
}

export interface PlaybackLimits {
  maxShortEdge: number;
  /** Ab dieser Bitrate wird neu kodiert, auch wenn der Codec passt. */
  maxBitrateBps: number;
}

/** Container, die Browser mit H.264 zuverlässig abspielen. */
const BROWSER_CONTAINERS = ['mp4', 'mov', 'm4v', 'isom', '3gp'];
/** Bild- und Tonformate, die jeder aktuelle Browser dekodiert. */
const BROWSER_VIDEO_CODECS = ['h264'];
const BROWSER_AUDIO_CODECS = ['aac', 'mp3'];
const BROWSER_PIXEL_FORMATS = ['yuv420p', 'yuvj420p'];

/**
 * Entscheidet, ob eine Datei überhaupt neu kodiert werden muss.
 *
 * Hintergrund: Ein fertiges 1080p-H.264-MP4 noch einmal durch x264 zu
 * schicken kostet Zeit und Qualität, ohne dass jemand etwas davon hat. Passt
 * alles, wird das Original direkt abgespielt; fehlt nur der vorgezogene
 * Index, genügt ein Neu-Verpacken in Sekunden.
 */
export function decidePlayback(
  candidate: PlaybackCandidate,
  limits: PlaybackLimits,
): PlaybackDecision {
  const { videoCodec, audioCodec, pixelFormat, width, height, bitrateBps } = candidate;

  if (!width || !height) {
    return { mode: 'TRANSCODE', reason: 'Auflösung unbekannt.' };
  }
  if (!videoCodec || !BROWSER_VIDEO_CODECS.includes(videoCodec.toLowerCase())) {
    return { mode: 'TRANSCODE', reason: `Videocodec ${videoCodec ?? 'unbekannt'} ist nichts für den Browser.` };
  }
  if (audioCodec && !BROWSER_AUDIO_CODECS.includes(audioCodec.toLowerCase())) {
    return { mode: 'TRANSCODE', reason: `Tonspur ${audioCodec} ist nichts für den Browser.` };
  }
  if (!pixelFormat || !BROWSER_PIXEL_FORMATS.includes(pixelFormat.toLowerCase())) {
    return { mode: 'TRANSCODE', reason: `Pixelformat ${pixelFormat ?? 'unbekannt'} ist nichts für den Browser.` };
  }
  if (!matchesContainer(candidate.formatName)) {
    return { mode: 'TRANSCODE', reason: `Container ${candidate.formatName ?? 'unbekannt'} ist nichts für den Browser.` };
  }

  const shortEdge = Math.min(width, height);
  if (shortEdge > limits.maxShortEdge) {
    return {
      mode: 'TRANSCODE',
      reason: `Kurze Kante ${shortEdge} px liegt über der Zielgröße von ${limits.maxShortEdge} px.`,
    };
  }
  if (bitrateBps && bitrateBps > limits.maxBitrateBps) {
    return {
      mode: 'TRANSCODE',
      reason: `Bitrate ${Math.round(bitrateBps / 1_000_000)} Mbit/s ist fürs Abspielen zu hoch.`,
    };
  }

  if (!candidate.fastStart) {
    return { mode: 'REMUX', reason: 'Bild und Ton passen; nur der Index muss nach vorn.' };
  }
  return { mode: 'ORIGINAL', reason: 'Das Original ist direkt abspielbar.' };
}

function matchesContainer(formatName: string | null): boolean {
  if (!formatName) return false;
  // ffprobe meldet für die MP4-Familie eine Liste wie „mov,mp4,m4a,3gp,3g2,mj2“.
  const names = formatName.toLowerCase().split(',');
  return names.some((name) => BROWSER_CONTAINERS.includes(name.trim()));
}

export interface SpritePlan {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  tileCount: number;
  intervalSeconds: number;
}

export interface SpritePlanInput {
  durationSeconds: number;
  sourceWidth: number;
  sourceHeight: number;
  tileWidth: number;
  columns: number;
  maxTiles: number;
}

/**
 * Ein Kachelbild für die Timeline-Vorschau. Ziel ist etwa eine Kachel pro
 * zwei Sekunden, gedeckelt auf `maxTiles` – ein Zweistünder bekommt also
 * gröbere Schritte statt einer riesigen Datei.
 *
 * Kachel `i` zeigt den Zeitpunkt `i * intervalSeconds`.
 */
export function planSprite(input: SpritePlanInput): SpritePlan | null {
  const { durationSeconds, sourceWidth, sourceHeight, tileWidth, columns, maxTiles } = input;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;

  const safeColumns = Math.max(1, Math.round(columns));
  const safeMaxTiles = Math.max(1, Math.round(maxTiles));
  const tileCount = Math.min(safeMaxTiles, Math.max(1, Math.round(durationSeconds / 2)));
  const rows = Math.ceil(tileCount / safeColumns);
  const intervalSeconds = durationSeconds / tileCount;

  return {
    columns: safeColumns,
    rows,
    tileWidth: toEven(tileWidth),
    tileHeight: toEven((tileWidth * sourceHeight) / sourceWidth),
    tileCount,
    intervalSeconds,
  };
}

/**
 * Zeitpunkt für den Posterframe: etwas hinein ins Bild, damit kein schwarzer
 * Vorspann als Vorschaubild landet – aber nie hinter dem Ende.
 */
export function planPosterTime(durationSeconds: number | null): number {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  return Math.min(durationSeconds * 0.1, 5, Math.max(0, durationSeconds - 0.1));
}

/**
 * Kurzform der Auflösung für Dateinamen: kurze Kante plus Bildrate, also
 * `2160p25` oder `1080p50`. Bei Hochformat greift ebenfalls die kurze Kante,
 * ein 1080×1920-Video heißt damit `1080p25` und nicht `1920p25`.
 */
export function resolutionLabel(
  width: number | null,
  height: number | null,
  frameRate: FrameRate | null,
): string | null {
  if (!width || !height) return null;
  const shortEdge = Math.min(width, height);
  if (!frameRate) return `${shortEdge}p`;

  const fps = frameRate.num / frameRate.den;
  const rounded = Math.round(fps);
  // Ganzzahlige Raten schlicht, NTSC-Raten in der üblichen Schreibweise
  // ohne Komma: 29,97 → 2997, 23,976 → 2398.
  const fpsLabel = Math.abs(fps - rounded) < 0.001 ? String(rounded) : String(Math.round(fps * 100));
  return `${shortEdge}p${fpsLabel}`;
}
