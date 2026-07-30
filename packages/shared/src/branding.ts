/**
 * White-Label pro Workspace: Titel, Logo, Akzentfarbe.
 *
 * Aus **einer** gewählten Farbe entstehen alle abgeleiteten Werte – eine
 * hellere Variante fürs Überfahren und eine lesbare Schriftfarbe darauf.
 * Sonst müsste der Admin drei Farben aufeinander abstimmen und säße am Ende
 * vor weißer Schrift auf gelbem Grund.
 */

export const DEFAULT_BRAND_TITLE = 'Klappe';
export const DEFAULT_BRAND_ACCENT = '#4c8dff';

/** Größte erlaubte Logodatei. Ein Logo ist ein Logo, kein Plakat. */
export const MAX_LOGO_BYTES = 512 * 1024;

/** Bildformate, die als Logo angenommen werden. */
export const LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
] as const;
export type LogoMimeType = (typeof LOGO_MIME_TYPES)[number];

/**
 * Was im Browser-Tab erscheint (Phase 23).
 *
 * - `standard`: das mitgelieferte Klappe-Zeichen.
 * - `logo`: dasselbe Bild wie oben links. Praktisch, wenn es ohnehin quadratisch
 *   ist – ein breites Schriftzug-Logo wird im 16-px-Tab allerdings zu Brei.
 * - `eigenes`: eine eigens dafür hochgeladene Datei. Für genau den Fall.
 */
export const FAVICON_MODES = ['standard', 'logo', 'eigenes'] as const;
export type FaviconMode = (typeof FAVICON_MODES)[number];

/** Ein Tab-Symbol ist winzig; mehr als das wäre in jedem Fall verschwendet. */
export const MAX_FAVICON_BYTES = 256 * 1024;

/** `ico` gehört dazu, weil viele Vorlagen genau das ausspucken. */
export const FAVICON_MIME_TYPES = [
  'image/png',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
] as const;
export type FaviconMimeType = (typeof FAVICON_MIME_TYPES)[number];

export interface BrandingDto {
  title: string;
  accent: string;
  /** Aufgehellte Fassung für Hover-Zustände. */
  accentHover: string;
  /** Schriftfarbe, die auf dem Akzent lesbar ist. */
  accentContrast: string;
  /** `null`, solange kein Logo hinterlegt ist. */
  logoUrl: string | null;
  /** Woher das Tab-Symbol kommt (Phase 23). */
  faviconMode: FaviconMode;
  /**
   * Was der Browser als Tab-Symbol laden soll. `null` heißt: das mitgelieferte
   * Zeichen bleibt – entweder weil `standard` gewählt ist oder weil zur
   * gewählten Quelle (noch) keine Datei vorliegt.
   */
  faviconUrl: string | null;
  /**
   * Das Haus, dem der Workspace gehört (Phase 20). Der Name steht in den
   * Einstellungen, das Kürzel in Klammern hinter jedem Namen aus dem eigenen
   * Team – damit an einem Kommentar zu sehen ist, wer von welcher Seite
   * schreibt. Beides `null`, solange nichts hinterlegt ist.
   */
  companyName: string | null;
  companyShort: string | null;
  updatedAt: string;
}

/**
 * `#abc`, `abc`, `#AABBCC` → `#aabbcc`. Alles andere ergibt `null`; der
 * Aufrufer bleibt dann beim bisherigen Wert, statt eine kaputte Farbe zu
 * speichern.
 */
export function normalizeHexColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().replace(/^#/, '').toLowerCase();

  if (/^[0-9a-f]{3}$/.test(raw)) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`;
  }
  if (/^[0-9a-f]{6}$/.test(raw)) return `#${raw}`;
  return null;
}

function channels(hex: string): [number, number, number] {
  const value = normalizeHexColor(hex) ?? DEFAULT_BRAND_ACCENT;
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function toHex(red: number, green: number, blue: number): string {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${[clamp(red), clamp(green), clamp(blue)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Relative Helligkeit nach WCAG – Grundlage für die Kontrastentscheidung. */
export function relativeLuminance(hex: string): number {
  const linear = channels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/**
 * Schwarz oder Weiß – je nachdem, was auf der Farbe besser lesbar ist. Die
 * Schwelle 0,42 liegt etwas unter der Mitte, weil Weiß auf mittleren Farben
 * in der Praxis früher unruhig wirkt als Schwarz.
 */
export function readableTextColor(hex: string): string {
  return relativeLuminance(hex) > 0.42 ? '#101114' : '#ffffff';
}

/** Etwas heller (oder bei sehr hellen Farben etwas dunkler) fürs Überfahren. */
export function hoverVariant(hex: string): string {
  const [red, green, blue] = channels(hex);
  const richtung = relativeLuminance(hex) > 0.6 ? -1 : 1;
  const schritt = 26 * richtung;
  return toHex(red + schritt, green + schritt, blue + schritt);
}

/** Aus der einen gewählten Farbe alle abgeleiteten Werte bauen. */
export function deriveBrandColors(accent: string | null | undefined): {
  accent: string;
  accentHover: string;
  accentContrast: string;
} {
  const base = normalizeHexColor(accent) ?? DEFAULT_BRAND_ACCENT;
  return {
    accent: base,
    accentHover: hoverVariant(base),
    accentContrast: readableTextColor(base),
  };
}

/** Der Titel steht im Kopf, im Browser-Tab und in jeder E-Mail. */
export function normalizeBrandTitle(value: string | null | undefined): string {
  const title = value?.trim().replace(/\s+/g, ' ') ?? '';
  return title.slice(0, 60) || DEFAULT_BRAND_TITLE;
}
