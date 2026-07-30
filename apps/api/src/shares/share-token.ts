/**
 * Der Token eines Freigabe-Links ist das einzige Geheimnis, das den Zugang
 * schützt, bevor sich der Gast per E-Mail-Code ausweist. Entsprechend
 * großzügig ist er bemessen.
 */
import { randomBytes } from 'node:crypto';

/**
 * Kleinbuchstaben und Ziffern ohne die Paare, die sich in den meisten
 * Schriften gleichen: `0`/`o` und `1`/`l`. Bleiben 32 Zeichen.
 */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const TOKEN_LENGTH = 24;

export function createShareToken(): string {
  // Zurückweisungsverfahren statt Modulo – sonst wären manche Zeichen
  // häufiger als andere.
  const out: string[] = [];
  while (out.length < TOKEN_LENGTH) {
    for (const byte of randomBytes(TOKEN_LENGTH)) {
      if (byte >= 256 - (256 % ALPHABET.length)) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === TOKEN_LENGTH) break;
    }
  }
  return out.join('');
}

export function isShareTokenShaped(value: string): boolean {
  return new RegExp(`^[${ALPHABET}]{${TOKEN_LENGTH}}$`).test(value);
}

/** Sechsstelliger Anmeldecode – führende Nullen bleiben erhalten. */
export function createLoginCode(): string {
  // `randomInt` wäre auch möglich; so bleibt es bei einer Quelle für Zufall.
  const value = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(value).padStart(6, '0');
}

export function isLoginCodeShaped(value: string): boolean {
  return /^\d{6}$/.test(value.trim());
}
