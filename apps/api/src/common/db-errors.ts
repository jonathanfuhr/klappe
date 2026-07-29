/**
 * Postgres-Fehler wiedererkennen, auch wenn Drizzle sie einpackt.
 *
 * Drizzle wirft einen `DrizzleQueryError`, dessen `message` nur die
 * abgeschickte Abfrage enthält; der eigentliche Fehler des Treibers – mit
 * `code` und `constraint` – hängt darunter in `cause`. Wer nur die oberste
 * Ebene prüft, findet den Verstoß gegen einen eindeutigen Index nicht und
 * lässt aus einem „Diesen Namen gibt es schon" ein nacktes 500 werden.
 */

/** Postgres meldet einen Verstoß gegen einen eindeutigen Index als 23505. */
const UNIQUE_VIOLATION = '23505';

interface PgFehler {
  code?: string;
  constraint?: string;
  cause?: unknown;
}

/**
 * Läuft die `cause`-Kette ab und liefert den ersten Postgres-Fehler darin.
 * Die Tiefe ist begrenzt, damit ein im Kreis zeigendes `cause` nicht hängt.
 */
function findePgFehler(error: unknown, tiefe = 5): PgFehler | null {
  if (!error || typeof error !== 'object' || tiefe < 0) return null;
  const kandidat = error as PgFehler;
  if (typeof kandidat.code === 'string') return kandidat;
  return findePgFehler(kandidat.cause, tiefe - 1);
}

/**
 * Name des verletzten eindeutigen Index – oder `null`, wenn es um etwas
 * anderes ging. Ohne Namen im Fehler kommt ein leerer String zurück: Es *war*
 * ein Eindeutigkeitsfehler, nur ohne Auskunft welcher.
 */
export function uniqueViolation(error: unknown): string | null {
  const pg = findePgFehler(error);
  if (!pg || pg.code !== UNIQUE_VIOLATION) return null;
  return pg.constraint ?? '';
}
