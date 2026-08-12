/**
 * Auftritte: fremde Erscheinungsbilder pro Projekt (1.6).
 *
 * Geht ein Film über eine Agentur zum Endkunden, soll deren Logo im Kopf
 * stehen und nicht unseres. Ein Projekt zeigt dafür auf einen Auftritt –
 * oder auf keinen, dann gilt das Erscheinungsbild des Workspace wie bisher.
 *
 * Hier steht nur die reine Logik: Was zu einem Auftritt gehört und wie sich
 * aus Auftritt und Workspace das **wirksame** Erscheinungsbild ergibt. Wo
 * die Dateien liegen, weiß der Server; was der Browser damit macht, die
 * Oberfläche.
 */

import type { BrandingDto } from './branding';
import { deriveBrandColors, normalizeBrandTitle } from './branding';
import { MAX_COMPANY_NAME_LENGTH, MAX_COMPANY_SHORT_LENGTH, normalizeCompanyText } from './company';

/**
 * Der Name trägt doppelt: Er steht in der Auswahl und ist zugleich der
 * angezeigte Titel. Deshalb dieselbe Grenze wie beim Titel des Workspace –
 * was im Kopf einer Seite nicht mehr passt, passt auch in der Liste nicht.
 */
export const MAX_BRAND_PROFILE_NAME_LENGTH = 60;

/** Länger wird ein Absendername in keinem Postfach mehr vollständig gezeigt. */
export const MAX_MAIL_FROM_NAME_LENGTH = 78;

/**
 * Was zum **Anzeigen** eines Auftritts nötig ist – mehr nicht.
 *
 * Diese Fassung hängt am Projekt und an der Freigabe-Vorschau und geht damit
 * auch an Gäste. Der Absendername und die Zahl der Projekte gehören nicht
 * dorthin: Der Endkunde einer Agentur muss nicht erfahren, an wie vielen
 * Projekten sie bei uns arbeitet.
 */
export interface BrandProfileRefDto {
  id: string;
  /** Bezeichnung in der Auswahl **und** angezeigter Titel. */
  name: string;
  accent: string;
  accentHover: string;
  accentContrast: string;
  /** `null`, solange kein Logo hinterlegt ist. */
  logoUrl: string | null;
  companyName: string | null;
  companyShort: string | null;
}

/** Die volle Fassung für die Verwaltung – nur fürs Team. */
export interface BrandProfileDto extends BrandProfileRefDto {
  /**
   * Absendername der Mails. Die Absender**adresse** bleibt die des Workspace –
   * sie hängt an SPF und DKIM und lässt sich nicht je Projekt wechseln.
   * `null` heißt: Es bleibt beim Namen des Workspace.
   */
  mailFromName: string | null;
  /**
   * An wie vielen Projekten der Auftritt hängt. Steht in der Verwaltung, weil
   * eine Änderung am Auftritt alle diese Projekte zugleich trifft – auch die
   * längst abgeschlossenen.
   */
  projectCount: number;
  updatedAt: string;
}

/**
 * Was beim Anlegen oder Ändern geschickt wird. Alles freiwillig außer dem
 * Namen beim Anlegen; ein leerer Text löscht das jeweilige Feld.
 */
export interface BrandProfileInput {
  name?: string;
  accent?: string;
  companyName?: string;
  companyShort?: string;
  mailFromName?: string;
}

/** Die Anzeige-Felder aus der vollen Fassung herauslösen. */
export function toBrandProfileRef(profile: BrandProfileDto): BrandProfileRefDto {
  return {
    id: profile.id,
    name: profile.name,
    accent: profile.accent,
    accentHover: profile.accentHover,
    accentContrast: profile.accentContrast,
    logoUrl: profile.logoUrl,
    companyName: profile.companyName,
    companyShort: profile.companyShort,
  };
}

/** Leerraum weg, Länge begrenzt. Ohne brauchbaren Rest bleibt es bei `null`. */
export function normalizeBrandProfileName(value: string | null | undefined): string | null {
  const sauber = value?.replace(/\s+/g, ' ').trim() ?? '';
  return sauber ? sauber.slice(0, MAX_BRAND_PROFILE_NAME_LENGTH) : null;
}

/** Wie der Name, nur mit der Grenze des Absenderfelds. */
export function normalizeMailFromName(value: string | null | undefined): string | null {
  const sauber = value?.replace(/\s+/g, ' ').trim() ?? '';
  return sauber ? sauber.slice(0, MAX_MAIL_FROM_NAME_LENGTH) : null;
}

/**
 * Das Erscheinungsbild, das für ein Projekt tatsächlich gilt.
 *
 * Reihenfolge: Auftritt, sonst Workspace. Ohne Auftritt kommt der Workspace
 * unverändert zurück – das ist der Normalfall und darf nichts kosten.
 *
 * Zwei Dinge kommen **immer** vom Workspace, auch unter fremdem Auftritt:
 *
 * - **Tab- und App-Symbol.** Sie hängen am Browser-Tab und am Startbildschirm,
 *   nicht am Projekt. Pro Projekt gewechselt würden sie beim Blättern zwischen
 *   zwei Projekten hin- und herspringen, und auf dem Startbildschirm eines
 *   iPhones landet ohnehin nur eines.
 * - **Die Sprachvorgabe.** Sie entscheidet, in welcher Sprache jemand ohne
 *   eigene Wahl die Oberfläche sieht. Das ist eine Einstellung des Hauses,
 *   keine des Kunden, für den ein Projekt läuft.
 *
 * Firmenname und Kürzel wechseln dagegen sehr wohl mit: Das Kürzel steht in
 * Klammern hinter den Namen des eigenen Teams, und unter einem Agenturlogo
 * hat dort unser eigenes nichts verloren – sonst ist die Sache mit dem ersten
 * Kommentar auf.
 */
export function effectiveBranding(
  workspace: BrandingDto,
  profile: BrandProfileRefDto | null | undefined,
): BrandingDto {
  if (!profile) return workspace;

  return {
    ...workspace,
    title: normalizeBrandTitle(profile.name),
    accent: profile.accent,
    accentHover: profile.accentHover,
    accentContrast: profile.accentContrast,
    logoUrl: profile.logoUrl,
    companyName: normalizeCompanyText(profile.companyName, MAX_COMPANY_NAME_LENGTH),
    companyShort: normalizeCompanyText(profile.companyShort, MAX_COMPANY_SHORT_LENGTH),
  };
}

/**
 * Farben eines Auftritts – dieselbe Ableitung wie beim Workspace, damit ein
 * Auftritt ohne eigene Farbe nicht farblos dasteht, sondern die des Hauses
 * erbt.
 */
export function brandProfileColors(
  accent: string | null | undefined,
  fallback: string | null | undefined,
): { accent: string; accentHover: string; accentContrast: string } {
  return deriveBrandColors(accent?.trim() || fallback);
}
