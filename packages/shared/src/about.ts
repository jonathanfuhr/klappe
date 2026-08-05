/**
 * „Über diese Software": feste Angaben zum Autor plus ein Freitext, den
 * jeder Admin für die eigene Umgebung pflegt (z. B. „läuft auf nativer
 * Hardware, kein NAS"). Wo der Container tatsächlich steht, kann Klappe
 * nicht selbst herausfinden – nur wer den Stack betreibt, weiß das.
 */

/** Mehr als das wäre kein Hinweis mehr, sondern ein zweites Handbuch. */
export const MAX_ENVIRONMENT_NOTES_LENGTH = 4000;

/**
 * Welcher Stand hier läuft (1.5.1).
 *
 * Vorher stand das nirgends: Ob ein Server den Stand von gestern oder von vor
 * zwei Wochen fuhr, war ihm nicht anzusehen – und genau das ist bei einem
 * Aufbau mit zwei Hälften (Container und nativer Worker) die häufigste
 * Fehlerursache gewesen.
 *
 * `version` folgt der Branch-Nummer (`version/1.5.1` → `1.5.1`), damit man
 * ohne Umrechnen weiß, worauf man schaut.
 */
export interface BuildInfoDto {
  /** Aus `package.json`, gleichlautend mit dem Branch. */
  version: string;
  /**
   * Der kurze Commit-Hash, sofern beim Bauen mitgegeben (`KLAPPE_COMMIT`).
   * `null` heißt: unbekannt – etwa bei `npm run dev`.
   */
  commit: string | null;
  /** Wann gebaut wurde, ISO-8601; `null`, wenn nicht mitgegeben. */
  builtAt: string | null;
}

export interface AboutDto {
  /** `null`, solange kein Admin etwas hinterlegt hat. */
  environmentNotes: string | null;
  updatedAt: string;
  /**
   * Der Stand **des API-Prozesses**. Die Oberfläche zeigt daneben ihren
   * eigenen: Laufen beide auseinander, ist genau das die Auskunft, die man
   * braucht.
   */
  build: BuildInfoDto;
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
