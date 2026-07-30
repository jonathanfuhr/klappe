/**
 * Schlagworte für Projekte (Phase 12).
 *
 * Wer ein Tag anlegt, soll keine Farbe wählen müssen. Ohne Angabe wird eine
 * aus dem Namen abgeleitet – gleicher Name, gleiche Farbe, und die Palette
 * ist so gewählt, dass sich benachbarte Tags in der Liste unterscheiden.
 */

/** Kräftige, gut unterscheidbare Töne, die auf dunklem Grund funktionieren. */
export const TAG_COLORS = [
  '#4c8dff',
  '#3fbf7f',
  '#e0a83c',
  '#e5484d',
  '#a56bff',
  '#22b8cf',
  '#f06595',
  '#8bc34a',
] as const;

export const MAX_TAG_NAME_LENGTH = 40;

/**
 * Farbe aus dem Namen. Bewusst eine stabile Streuung und kein Zufall: Ein
 * Tag soll nach dem Umbenennen zwar anders, nach einem Neuladen aber nicht
 * plötzlich anders aussehen.
 */
export function colorForTagName(name: string): string {
  let hash = 0;
  const key = normalizeTagName(name).toLowerCase();
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length];
}

/** Leerraum aufräumen und auf eine handliche Länge kürzen. */
export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_NAME_LENGTH);
}

/** Zwei Tags gelten als gleich, wenn sie sich nur in der Schreibweise unterscheiden. */
export function isSameTagName(left: string, right: string): boolean {
  return normalizeTagName(left).toLowerCase() === normalizeTagName(right).toLowerCase();
}
