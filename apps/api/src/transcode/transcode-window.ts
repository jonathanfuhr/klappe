/**
 * Zeitfenster für die aufwendige Nacharbeit (Phase 19).
 *
 * Gedacht für Anlagen, auf denen tagsüber gearbeitet wird: Die Download-
 * Fassungen und die HLS-Leiter entstehen dann nachts, wenn niemand den Server
 * braucht. Was *jemand gerade erwartet* – die Abspielfassung nach dem Upload,
 * ein angeforderter Download – läuft nie im Fenster, sondern sofort; sonst
 * klickt der Kunde auf Herunterladen und es passiert acht Stunden lang nichts.
 *
 * Reine Rechnerei, damit sie ohne Warteschlange prüfbar ist.
 */

/** Minuten seit Mitternacht, Ortszeit des Containers. `null` = kein Fenster. */
export interface TranscodeWindow {
  startMinute: number | null;
  endMinute: number | null;
}

const TAG_MS = 24 * 60 * 60 * 1000;

/** Liegt der Wert in einem sinnvollen Bereich für „Minute des Tages"? */
export function isValidMinute(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1439;
}

/**
 * Wie lange muss ein Auftrag warten, bis das Fenster offen ist? `0` heißt:
 * sofort loslegen.
 *
 * Ein Start hinter dem Ende meint die Nacht (22:00–6:00). Start gleich Ende
 * wird als „kein Fenster" gelesen und nicht als „nie" – ein Tippfehler soll
 * die Warteschlange nicht stilllegen.
 */
export function delayUntilWindow(now: Date, fenster: TranscodeWindow): number {
  const { startMinute, endMinute } = fenster;
  if (!isValidMinute(startMinute) || !isValidMinute(endMinute)) return 0;
  if (startMinute === endMinute) return 0;

  const jetzt =
    ((now.getHours() * 60 + now.getMinutes()) * 60 + now.getSeconds()) * 1000 +
    now.getMilliseconds();
  const start = startMinute * 60_000;
  const ende = endMinute * 60_000;

  const drin = start < ende ? jetzt >= start && jetzt < ende : jetzt >= start || jetzt < ende;
  if (drin) return 0;

  const rest = start - jetzt;
  return rest >= 0 ? rest : rest + TAG_MS;
}

/** `1320` → `22:00`. Für Anzeige und Protokoll. */
export function formatMinute(value: number | null): string | null {
  if (!isValidMinute(value)) return null;
  const stunden = String(Math.floor(value / 60)).padStart(2, '0');
  const minuten = String(value % 60).padStart(2, '0');
  return `${stunden}:${minuten}`;
}

/** `22:00` → `1320`. `null` bei allem, was keine Uhrzeit ist. */
export function parseMinute(value: string | null | undefined): number | null {
  if (!value) return null;
  const treffer = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!treffer) return null;
  const stunden = Number(treffer[1]);
  const minuten = Number(treffer[2]);
  if (stunden > 23 || minuten > 59) return null;
  return stunden * 60 + minuten;
}
