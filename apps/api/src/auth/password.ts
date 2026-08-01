/**
 * Passwort-Hashing mit scrypt aus der Node-Standardbibliothek – bewusst ohne
 * zusätzliche Abhängigkeit und ohne nativ zu kompilierende Pakete.
 *
 * Format: `scrypt$N$r$p$salt$hash` (beides Base64). Die Parameter stehen mit
 * im Hash, damit sie später erhöht werden können, ohne alte Hashes zu brechen.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { PasswordPolicy } from '@klappe/shared';
import { DEFAULT_PASSWORD_POLICY, validatePassword } from '@klappe/shared';
import type { MessageRef, PasswordErrorKey } from '@klappe/shared';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** scrypt braucht ~128·N·r Byte; mit Reserve, sonst wirft Node bei N=16384. */
const MAX_MEM = 64 * 1024 * 1024;

/**
 * Nur noch die Untergrenze für die Formularprüfung – die tatsächliche Länge
 * gibt seit Phase 24 die Richtlinie des Workspace vor.
 */
export const MIN_PASSWORD_LENGTH = DEFAULT_PASSWORD_POLICY.minLength;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const { N, r, p } = DEFAULT_PARAMS;
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: MAX_MEM,
  });
  return ['scrypt', N, r, p, salt.toString('base64'), derived.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
    N,
    r,
    p,
    maxmem: MAX_MEM,
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Liefert `null`, wenn das Passwort in Ordnung ist, sonst den Grund.
 *
 * Seit Phase 24 entscheidet das die Richtlinie des Workspace, nicht mehr eine
 * feste Regel hier. Ohne Angabe gilt der Vorgabewert – genau die alten Regeln,
 * damit ein Aufruf ohne Richtlinie sich nicht plötzlich anders verhält.
 */
export function validatePasswordStrength(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): string | null {
  const problem = validatePassword(password, policy);
  return problem ? passwortMeldung(problem) : null;
}

/**
 * Der deutsche Satz zum Verstoß (Phase 26).
 *
 * Das gemeinsame Paket liefert nur noch den Schlüssel – es weiß nicht, wer
 * fragt. Hier entsteht daraus der deutsche Satz; ins Englische bringt ihn
 * später der Fehlerfilter, wie jede andere Meldung der API auch.
 */
function passwortMeldung(problem: MessageRef<PasswordErrorKey>): string {
  switch (problem.key) {
    case 'passwordError.minLength':
      return `Das Passwort muss mindestens ${problem.vars?.count} Zeichen lang sein.`;
    case 'passwordError.maxLength':
      return `Das Passwort darf höchstens ${problem.vars?.count} Zeichen lang sein.`;
    case 'passwordError.letter':
      return 'Das Passwort muss mindestens einen Buchstaben enthalten.';
    case 'passwordError.digit':
      return 'Das Passwort muss mindestens eine Ziffer enthalten.';
    case 'passwordError.mixedCase':
      return 'Das Passwort muss Groß- und Kleinbuchstaben enthalten.';
    case 'passwordError.symbol':
      return 'Das Passwort muss mindestens ein Sonderzeichen enthalten.';
  }
}
