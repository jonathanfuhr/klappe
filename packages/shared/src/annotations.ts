/**
 * Zeichnungen auf dem Videobild (Phase 5).
 *
 * Eine Zeichnung gehört immer zu einem Kommentar und damit zu genau einem
 * Frame. Gespeichert wird sie **auflösungsunabhängig**: Alle Koordinaten
 * liegen im Bereich 0…1, bezogen auf die Bildbreite bzw. -höhe. Damit passt
 * dieselbe Zeichnung auf den 1080p-Proxy im Browserfenster, auf ein
 * Vollbild auf 4K und auf ein Vorschaubild – ohne Umrechnung beim Speichern.
 *
 * Die Strichstärke ist ebenfalls normalisiert, und zwar auf die **Höhe**:
 * So bleibt ein Strich bei jedem Seitenverhältnis gleich dick im Verhältnis
 * zum Bild.
 */

/** Punkt im normalisierten Bildraum (0…1 in beide Richtungen). */
export interface AnnotationPoint {
  x: number;
  y: number;
}

export interface AnnotationStroke {
  /** Farbe als `#rrggbb`. */
  color: string;
  /** Strichstärke als Anteil der Bildhöhe, z. B. 0.004 ≈ 4 px bei 1080p. */
  width: number;
  points: AnnotationPoint[];
}

export interface Annotation {
  strokes: AnnotationStroke[];
}

/** Vorgabefarben des Stifts – kräftig genug für helles wie dunkles Bild. */
export const ANNOTATION_COLORS = [
  '#ff3b30',
  '#ffcc00',
  '#34c759',
  '#32ade6',
  '#ffffff',
  '#000000',
] as const;

export const ANNOTATION_STROKE_WIDTHS = [0.002, 0.004, 0.008] as const;
export const DEFAULT_ANNOTATION_WIDTH = 0.004;

/** Obergrenzen – sie halten sowohl die Datenbank als auch das Zeichnen flott. */
export const MAX_STROKES_PER_ANNOTATION = 60;
export const MAX_POINTS_PER_STROKE = 600;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Auf drei Nachkommastellen runden – bei 4K ist das unter einem Pixel. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Prüft und säubert eine Zeichnung aus einer fremden Quelle (Browser oder
 * API-Aufruf). Gibt `null` zurück, wenn nichts Verwertbares übrig bleibt –
 * dann wird der Kommentar einfach ohne Zeichnung gespeichert.
 *
 * Bewusst nachsichtig statt streng: Ein einzelner kaputter Punkt soll nicht
 * die ganze Anmerkung des Kunden verwerfen.
 */
export function sanitizeAnnotation(input: unknown): Annotation | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as { strokes?: unknown };
  if (!Array.isArray(raw.strokes)) return null;

  const strokes: AnnotationStroke[] = [];

  for (const candidate of raw.strokes.slice(0, MAX_STROKES_PER_ANNOTATION)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const stroke = candidate as { color?: unknown; width?: unknown; points?: unknown };

    const color = typeof stroke.color === 'string' && HEX_COLOR.test(stroke.color)
      ? stroke.color.toLowerCase()
      : ANNOTATION_COLORS[0];

    const width =
      typeof stroke.width === 'number' && Number.isFinite(stroke.width)
        ? Math.max(0.0005, Math.min(0.05, stroke.width))
        : DEFAULT_ANNOTATION_WIDTH;

    if (!Array.isArray(stroke.points)) continue;

    const points: AnnotationPoint[] = [];
    for (const point of stroke.points.slice(0, MAX_POINTS_PER_STROKE)) {
      if (!point || typeof point !== 'object') continue;
      const { x, y } = point as { x?: unknown; y?: unknown };
      if (typeof x !== 'number' || typeof y !== 'number') continue;
      points.push({ x: round(clamp01(x)), y: round(clamp01(y)) });
    }

    // Ein einzelner Punkt ist ein Tippen – auch das ist eine gültige Markierung.
    if (points.length === 0) continue;
    strokes.push({ color, width: round(width * 1000) / 1000, points });
  }

  return strokes.length > 0 ? { strokes } : null;
}

/** Ist überhaupt etwas gezeichnet? */
export function isAnnotationEmpty(annotation: Annotation | null | undefined): boolean {
  return !annotation || annotation.strokes.length === 0;
}

/** Anzahl der Punkte insgesamt – für Anzeige und Grenzwerte. */
export function annotationPointCount(annotation: Annotation): number {
  return annotation.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
}
