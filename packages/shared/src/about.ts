/**
 * „Über diese Software": feste Angaben zum Autor plus ein Freitext, den
 * jeder Admin für die eigene Umgebung pflegt (z. B. „läuft auf nativer
 * Hardware, kein NAS"). Wo der Container tatsächlich steht, kann Klappe
 * nicht selbst herausfinden – nur wer den Stack betreibt, weiß das.
 */

/** Mehr als das wäre kein Hinweis mehr, sondern ein zweites Handbuch. */
export const MAX_ENVIRONMENT_NOTES_LENGTH = 4000;

export interface AboutDto {
  /** `null`, solange kein Admin etwas hinterlegt hat. */
  environmentNotes: string | null;
  updatedAt: string;
}

/**
 * `\r\n` vereinheitlichen und außen kürzen, Zeilenumbrüche innen aber
 * erhalten – anders als beim Firmenkürzel ist das hier ein mehrzeiliger
 * Hinweistext, keine Ein-Wort-Angabe.
 */
export function normalizeEnvironmentNotes(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, MAX_ENVIRONMENT_NOTES_LENGTH);
}
