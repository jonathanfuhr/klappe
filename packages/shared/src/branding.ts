/**
 * White-Label pro Workspace: Titel, Logo, Akzentfarbe.
 *
 * Aus **einer** gewählten Farbe entstehen alle abgeleiteten Werte – eine
 * hellere Variante fürs Überfahren und eine lesbare Schriftfarbe darauf.
 * Sonst müsste der Admin drei Farben aufeinander abstimmen und säße am Ende
 * vor weißer Schrift auf gelbem Grund.
 */

import type { Locale } from './i18n';

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
 * Tab-Symbol und App-Symbol (Phase 24).
 *
 * Beide werden fertig hochgeladen, nichts wird daraus abgeleitet. Der Versuch,
 * sie aus dem Logo zu rechnen, ging schief: Was im Kopf neben dem Titel gut
 * aussieht, taugt im 16-Pixel-Tab selten, und wer sein Symbol genau haben will,
 * baut es ohnehin selbst. Zwei Felder mit klarer Größenempfehlung sind
 * ehrlicher als eine Automatik, die man hinterher zurechtbiegen muss.
 */

/** Ein Tab-Symbol ist winzig; mehr als das wäre in jedem Fall verschwendet. */
export const MAX_FAVICON_BYTES = 256 * 1024;

/**
 * Nur `.ico`: Das ist das Format, das jeder Browser im Tab annimmt, und in
 * einer Datei stecken alle nötigen Größen zugleich.
 */
export const FAVICON_MIME_TYPES = ['image/x-icon', 'image/vnd.microsoft.icon'] as const;
export type FaviconMimeType = (typeof FAVICON_MIME_TYPES)[number];

/** Die Größen, die in eine `.ico` gehören – als Empfehlung in der Oberfläche. */
export const FAVICON_RECOMMENDED_SIZES = [16, 32, 48] as const;

/**
 * Empfohlene Kantenlänge des App-Symbols.
 *
 * 512 ist die größte Größe, die ein Web-App-Manifest üblicherweise verlangt;
 * Browser und iOS rechnen daraus alles Kleinere selbst herunter. Eine einzige
 * quadratische Datei genügt also.
 */
export const APP_ICON_SIZE = 512;

/** Nur PNG: Ein SVG nimmt der iOS-Startbildschirm als App-Symbol nicht an. */
export const APP_ICON_MIME_TYPES = ['image/png'] as const;
export type AppIconMimeType = (typeof APP_ICON_MIME_TYPES)[number];

/** Ein 512er PNG bleibt weit darunter; die Grenze fängt nur Unfug ab. */
export const MAX_APP_ICON_BYTES = 512 * 1024;

export interface BrandingDto {
  title: string;
  /**
   * Sprache des Workspace (Phase 26). Steht hier, weil das Erscheinungsbild
   * ohnehin auf **jeder** Seite ohne Anmeldung geholt wird – Anmeldeseite,
   * Gast-Gatter, eingebetteter Player. Wer nichts eigenes gewählt hat, sieht
   * Klappe in dieser Sprache, und in ihr gehen auch die Mails raus.
   */
  defaultLocale: Locale;
  accent: string;
  /** Aufgehellte Fassung für Hover-Zustände. */
  accentHover: string;
  /** Schriftfarbe, die auf dem Akzent lesbar ist. */
  accentContrast: string;
  /** `null`, solange kein Logo hinterlegt ist. */
  logoUrl: string | null;
  /**
   * Die hochgeladene `.ico` fürs Browser-Tab. `null` heißt: Es bleibt beim
   * mitgelieferten Klappe-Zeichen.
   */
  faviconUrl: string | null;
  /**
   * Das hochgeladene App-Symbol als PNG – für den iOS-Startbildschirm und das
   * Web-App-Manifest. `null`, solange keines hinterlegt ist.
   */
  appIconUrl: string | null;
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
