/**
 * Wie groß wird der Proxy, und wie sieht der Sprite-Streifen für die Timeline
 * aus? Reine Rechnerei, damit sie ohne laufendes ffmpeg prüfbar ist.
 */

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
 * Skaliert auf die Zielhöhe (Standard 1080), aber niemals nach oben – aus
 * einem 720p-Original wird kein aufgeblasener 1080p-Proxy.
 */
export function planProxyScale(
  sourceWidth: number,
  sourceHeight: number,
  maxHeight: number,
): ProxyScale {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError('Ungültige Quellauflösung.');
  }
  if (sourceHeight <= maxHeight) {
    return { width: toEven(sourceWidth), height: toEven(sourceHeight), scaled: false };
  }
  const height = toEven(maxHeight);
  const width = toEven((sourceWidth * height) / sourceHeight);
  return { width, height, scaled: true };
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
