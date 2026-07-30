/**
 * Das Firmenkürzel hinter Namen des eigenen Teams (Phase 20).
 *
 * In einem Projekt sitzen Leute aus zwei Häusern: das Team, dem der
 * Workspace gehört, und die Gäste beim Kunden. An einem Kommentar stand
 * bisher nur ein Name – wer dahintersteckt, musste man wissen. Das Kürzel
 * in Klammern beantwortet das an jeder Stelle, an der ein Name auftaucht.
 *
 * Nur für das eigene Team. Ein Gast bekommt keines: Sein Haus ist nicht
 * dieses, und ein zweites Kürzel dafür zu pflegen hilft niemandem.
 */

/** Länger als das wird ein Kürzel unleserlich, sobald es hinter jedem Namen steht. */
export const MAX_COMPANY_SHORT_LENGTH = 12;
export const MAX_COMPANY_NAME_LENGTH = 120;

/** Leerraum weg, mehrfache Leerzeichen zu einem. `null` bei nichts Brauchbarem. */
export function normalizeCompanyText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  const sauber = value.replace(/\s+/g, ' ').trim();
  if (!sauber) return null;
  return sauber.slice(0, maxLength);
}

/**
 * `Anna Meier` + `BSP` → `Anna Meier (BSP)`.
 *
 * Ohne hinterlegtes Kürzel, für Gäste und für einen leeren Namen bleibt es
 * beim Namen allein. Trägt der Name das Kürzel schon (jemand hat es von Hand
 * eingetippt), wird es nicht verdoppelt.
 */
export function displayUserName(
  name: string,
  role: string | null | undefined,
  companyShort: string | null | undefined,
): string {
  const kuerzel = normalizeCompanyText(companyShort, MAX_COMPANY_SHORT_LENGTH);
  if (!kuerzel || !name) return name;
  if (role !== 'ADMIN' && role !== 'MEMBER') return name;
  if (name.toLowerCase().endsWith(`(${kuerzel.toLowerCase()})`)) return name;
  return `${name} (${kuerzel})`;
}
