/**
 * Passwort-Hashing mit scrypt aus der Node-Standardbibliothek – bewusst ohne
 * zusätzliche Abhängigkeit und ohne nativ zu kompilierende Pakete.
 *
 * Format: `scrypt$N$r$p$salt$hash` (beides Base64). Die Parameter stehen mit
 * im Hash, damit sie später erhöht werden können, ohne alte Hashes zu brechen.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

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

export const MIN_PASSWORD_LENGTH = 10;

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

/** Liefert `null`, wenn das Passwort in Ordnung ist, sonst den Grund. */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`;
  }
  if (password.length > 512) {
    return 'Das Passwort darf höchstens 512 Zeichen lang sein.';
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Das Passwort muss Buchstaben und Ziffern enthalten.';
  }
  return null;
}
