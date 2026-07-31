/**
 * Das Format der API-Tokens (Phase 25).
 *
 * Ein Token besteht aus zwei Teilen: einem **Merkmal**, das offen in der
 * Datenbank steht und nur zum Nachschlagen dient, und einem **Geheimnis**, von
 * dem dort nur der Hash liegt. Beides zusammen ergibt die Zeichenkette, die
 * das Plugin speichert:
 *
 * ```
 * klp_<merkmal>_<geheimnis>
 * ```
 *
 * Warum getrennt? Ein Hash mit zufälligem Salz – wie bei Passwörtern – lässt
 * sich nicht nachschlagen; der Server müsste bei jeder Anfrage jeden
 * gespeicherten Token durchprobieren. Mit dem offenen Merkmal wird daraus ein
 * Treffer über einen Index, und geprüft wird nur der eine gefundene Hash.
 *
 * Warum SHA-256 und nicht scrypt wie beim Passwort? Weil es hier nichts zu
 * raten gibt: Das Geheimnis sind 32 zufällige Bytes, kein von Menschen
 * gewähltes Wort. Ein absichtlich langsames Verfahren würde nur jede einzelne
 * API-Anfrage um ~100 ms verzögern, ohne etwas zu schützen.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Vorsilbe aller Klappe-Tokens. Sie steht bewusst vorn: Der Wächter erkennt
 * daran sofort, dass ein `Authorization: Bearer …` kein Sitzungs-JWT ist, und
 * Werkzeuge wie die Geheimnis-Suche von GitHub finden ein versehentlich
 * eingecheckten Token an genau diesem Muster.
 */
export const API_TOKEN_PREFIX = 'klp_';

/**
 * Kleinbuchstaben und Ziffern ohne die Paare, die sich in den meisten
 * Schriften gleichen (`0`/`o`, `1`/`l`) – dieselbe Auswahl wie beim
 * Freigabe-Token. Ein Token wird gelegentlich abgetippt.
 */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Länge des offenen Teils. 12 Zeichen aus 32 Zeichen sind 60 Bit – als reine Kennung reichlich. */
const SELECTOR_LENGTH = 12;
/** Länge des geheimen Teils. 40 Zeichen sind 200 Bit; da rät niemand. */
const SECRET_LENGTH = 40;

export interface NewApiToken {
  /** Die vollständige Zeichenkette – existiert genau einmal und wird nie gespeichert. */
  plaintext: string;
  /** Offener Teil, steht in der Datenbank und dient dem Nachschlagen. */
  selector: string;
  /** Hash des geheimen Teils. */
  secretHash: string;
}

/**
 * Zieht Zeichen aus dem Alphabet über ein Zurückweisungsverfahren: Bytes
 * jenseits des letzten vollen Vielfachen fallen weg, sonst kämen die ersten
 * Zeichen des Alphabets häufiger vor als die letzten.
 */
function randomString(length: number): string {
  const out: string[] = [];
  const grenze = 256 - (256 % ALPHABET.length);
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= grenze) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

export function hashApiTokenSecret(secret: string): string {
  return createHash('sha256').update(`klappe:api-token:${secret}`).digest('base64url');
}

export function createApiToken(): NewApiToken {
  const selector = randomString(SELECTOR_LENGTH);
  const secret = randomString(SECRET_LENGTH);
  return {
    plaintext: `${API_TOKEN_PREFIX}${selector}_${secret}`,
    selector,
    secretHash: hashApiTokenSecret(secret),
  };
}

/** Sieht dieser Wert nach einem API-Token aus? Entscheidet, welchen Weg der Wächter geht. */
export function isApiTokenShaped(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(API_TOKEN_PREFIX);
}

/**
 * Zerlegt einen Token in seine zwei Teile. `null` heißt: gar nicht erst
 * nachschlagen – die Form stimmt nicht.
 */
export function parseApiToken(value: string): { selector: string; secret: string } | null {
  if (!isApiTokenShaped(value)) return null;

  const rest = value.slice(API_TOKEN_PREFIX.length);
  const trenner = rest.indexOf('_');
  if (trenner <= 0) return null;

  const selector = rest.slice(0, trenner);
  const secret = rest.slice(trenner + 1);
  if (selector.length !== SELECTOR_LENGTH || secret.length !== SECRET_LENGTH) return null;

  return { selector, secret };
}

/**
 * Vergleicht zeitkonstant. Ein Unterschied in der Laufzeit verriete sonst
 * Stück für Stück den richtigen Hash – auch wenn das Geheimnis dahinter
 * ohnehin nicht zu raten ist, kostet die saubere Variante hier nichts.
 */
export function verifyApiTokenSecret(secret: string, storedHash: string): boolean {
  const links = Buffer.from(hashApiTokenSecret(secret));
  const rechts = Buffer.from(storedHash);
  if (links.length !== rechts.length) return false;
  return timingSafeEqual(links, rechts);
}

/**
 * Was in der Liste der verbundenen Geräte steht, wenn der Token selbst längst
 * weg ist: `klp_a3f…` – genug zum Wiedererkennen, zu wenig zum Benutzen.
 */
export function maskApiToken(selector: string): string {
  return `${API_TOKEN_PREFIX}${selector.slice(0, 4)}…`;
}
