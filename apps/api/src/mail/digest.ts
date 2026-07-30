/**
 * Die Entscheidung hinter den Sammelmails (Phase 18): Ist die Ruhezeit
 * abgelaufen, oder kam gerade noch ein Kommentar dazu?
 *
 * Absichtlich eine reine Funktion ohne Datenbank und Uhr. Der Ablauf ist
 * fehleranfällig genug – ein zu früher Versand zerreißt die Sammlung, ein
 * vergessener Nachschlag lässt die Mail für immer liegen.
 */

export interface DigestDecision {
  /** Jetzt verschicken? */
  send: boolean;
  /** Sonst: in so vielen Millisekunden noch einmal nachsehen. */
  retryInMs: number;
}

/**
 * Ohne Toleranz würde sich ein Job, der eine Millisekunde zu früh dran ist,
 * selbst um diese Millisekunde weiterreichen – und das beliebig oft.
 */
export const DIGEST_TOLERANCE_MS = 2_000;

export function decideDigest(input: {
  /** Zeitpunkt der jüngsten wartenden Benachrichtigung. */
  newestAt: number;
  now: number;
  /** Eingestellte Ruhezeit; `0` heißt sofort. */
  minutes: number;
  toleranceMs?: number;
}): DigestDecision {
  const toleranz = input.toleranceMs ?? DIGEST_TOLERANCE_MS;
  const rest = input.minutes * 60_000 - (input.now - input.newestAt);

  // Die Ruhezeit wird gegen die *aktuelle* Einstellung gerechnet, nicht gegen
  // die vom Einreihen. Wer sie hochsetzt, während etwas wartet, bekommt
  // deshalb keine verfrühte Mail – der Job legt sich stattdessen noch einmal
  // hin und kommt später wieder.
  if (rest > toleranz) return { send: false, retryInMs: rest };
  return { send: true, retryInMs: 0 };
}
