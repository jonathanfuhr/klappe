/**
 * Passwort-Richtlinie des Workspace (Phase 24).
 *
 * Bis dahin standen die Regeln fest im Code: mindestens zehn Zeichen,
 * Buchstaben und Ziffern. Was in einem Haus reicht, ist im nächsten zu wenig –
 * deshalb stellt sie jetzt der Admin unter Einstellungen → Anmeldung ein.
 *
 * Die Prüfung liegt hier im gemeinsamen Paket, damit Oberfläche und API
 * dieselbe Antwort geben. Die API ist die verbindliche Instanz; die Oberfläche
 * benutzt sie nur, um vorher schon zu sagen, was fehlt, statt den Menschen ins
 * offene Messer laufen zu lassen.
 */

export interface PasswordPolicy {
  /** Untergrenze der Länge. */
  minLength: number;
  /** Mindestens ein Buchstabe. */
  requireLetter: boolean;
  /** Mindestens eine Ziffer. */
  requireDigit: boolean;
  /** Groß- **und** Kleinbuchstaben. */
  requireMixedCase: boolean;
  /** Mindestens ein Zeichen, das weder Buchstabe noch Ziffer ist. */
  requireSymbol: boolean;
}

/**
 * Was bisher galt – und damit die Vorgabe für jede bestehende Anlage. Ein
 * Update darf niemandem sein Passwort ungültig machen.
 */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 10,
  requireLetter: true,
  requireDigit: true,
  requireMixedCase: false,
  requireSymbol: false,
};

/**
 * Grenzen für die Einstellung selbst. Unter acht Zeichen ist ein Passwort
 * heute nicht mehr ernst zu nehmen; über 128 hinaus ist es keine Sicherheit
 * mehr, sondern eine Zumutung, die zum Zettel am Bildschirm führt.
 */
export const PASSWORD_MIN_LENGTH_FLOOR = 8;
export const PASSWORD_MIN_LENGTH_CEILING = 128;

/** Obergrenze für das Passwort selbst – gegen absichtlich riesige Eingaben. */
export const PASSWORD_MAX_LENGTH = 512;

/** Fängt unsinnige Werte ab, ohne die Einstellung zu verweigern. */
export function normalizePasswordPolicy(input: Partial<PasswordPolicy> | null): PasswordPolicy {
  const roh = input?.minLength ?? DEFAULT_PASSWORD_POLICY.minLength;
  const minLength = Math.min(
    PASSWORD_MIN_LENGTH_CEILING,
    Math.max(PASSWORD_MIN_LENGTH_FLOOR, Math.round(Number.isFinite(roh) ? roh : 10)),
  );

  return {
    minLength,
    requireLetter: input?.requireLetter ?? DEFAULT_PASSWORD_POLICY.requireLetter,
    requireDigit: input?.requireDigit ?? DEFAULT_PASSWORD_POLICY.requireDigit,
    requireMixedCase: input?.requireMixedCase ?? DEFAULT_PASSWORD_POLICY.requireMixedCase,
    requireSymbol: input?.requireSymbol ?? DEFAULT_PASSWORD_POLICY.requireSymbol,
  };
}

/**
 * Liefert `null`, wenn das Passwort der Richtlinie genügt, sonst den Grund im
 * Klartext – **eine** Meldung, nicht eine Liste: Wer sie abarbeitet, kommt bei
 * der nächsten Rückmeldung ohnehin zur nächsten Regel.
 */
export function validatePassword(password: string, policy: PasswordPolicy): string | null {
  if (password.length < policy.minLength) {
    return `Das Passwort muss mindestens ${policy.minLength} Zeichen lang sein.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Das Passwort darf höchstens ${PASSWORD_MAX_LENGTH} Zeichen lang sein.`;
  }
  if (policy.requireLetter && !/\p{L}/u.test(password)) {
    return 'Das Passwort muss mindestens einen Buchstaben enthalten.';
  }
  if (policy.requireDigit && !/\p{Nd}/u.test(password)) {
    return 'Das Passwort muss mindestens eine Ziffer enthalten.';
  }
  if (policy.requireMixedCase && !(/\p{Lu}/u.test(password) && /\p{Ll}/u.test(password))) {
    return 'Das Passwort muss Groß- und Kleinbuchstaben enthalten.';
  }
  if (policy.requireSymbol && !/[^\p{L}\p{Nd}]/u.test(password)) {
    return 'Das Passwort muss mindestens ein Sonderzeichen enthalten.';
  }
  return null;
}

/**
 * Die Regeln als Aufzählung – für den Hinweis unter dem Eingabefeld. Ein
 * „mindestens 12 Zeichen, Groß- und Kleinbuchstaben" vorab erspart das Raten
 * nach der Absage.
 */
export function describePasswordPolicy(policy: PasswordPolicy): string[] {
  const regeln = [`mindestens ${policy.minLength} Zeichen`];
  if (policy.requireLetter) regeln.push('mindestens ein Buchstabe');
  if (policy.requireDigit) regeln.push('mindestens eine Ziffer');
  if (policy.requireMixedCase) regeln.push('Groß- und Kleinbuchstaben');
  if (policy.requireSymbol) regeln.push('mindestens ein Sonderzeichen');
  return regeln;
}
