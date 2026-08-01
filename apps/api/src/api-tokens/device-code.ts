/**
 * Die beiden Codes der Gerätekopplung (Phase 27).
 *
 * Beim Verbinden eines Plugins entstehen zwei sehr verschiedene Zeichenketten,
 * und die Unterschiede sind Absicht:
 *
 * - Der **Gerätecode** ist lang und zufällig. Ihn sieht niemand; das Plugin
 *   behält ihn für sich und holt damit später seinen Token ab. In der
 *   Datenbank liegt nur sein Hash.
 * - Der **Benutzercode** ist kurz und gut abzulesen: `KHFP-3RTM`. Er steht auf
 *   dem Bildschirm des Schnittplatzes und wird von Hand in den Browser
 *   getippt – notfalls auf einem anderen Gerät.
 *
 * Weil der Benutzercode kurz ist, ist er allein wertlos: Er schaltet nichts
 * frei, sondern benennt nur eine wartende Anfrage, die ein angemeldeter Mensch
 * erst bestätigen muss. Und selbst dann bekommt den Token nur, wer den langen
 * Gerätecode hat.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Großbuchstaben und Ziffern ohne alles, was sich beim Abtippen verwechseln
 * lässt: kein `I`, `L`, `O`, `0`, `1`. Bleiben 31 Zeichen.
 */
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Zwei Vierergruppen: 31^8 ≈ 8,5·10^11 Möglichkeiten. */
const USER_CODE_GROUP = 4;
const USER_CODE_GROUPS = 2;

const DEVICE_CODE_BYTES = 32;

function randomFrom(alphabet: string, length: number): string {
  const out: string[] = [];
  const grenze = 256 - (256 % alphabet.length);
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= grenze) continue;
      out.push(alphabet[byte % alphabet.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

/** `KHFP-3RTM` – mit Bindestrich, weil er so leichter vorzulesen ist. */
export function createUserCode(): string {
  const gruppen: string[] = [];
  for (let i = 0; i < USER_CODE_GROUPS; i += 1) {
    gruppen.push(randomFrom(USER_CODE_ALPHABET, USER_CODE_GROUP));
  }
  return gruppen.join('-');
}

/**
 * Vereinheitlicht die Eingabe, bevor gesucht wird: Kleinschreibung,
 * fehlender Bindestrich und Leerzeichen sollen nicht am Verbinden hindern.
 * `null` heißt: die Form stimmt nicht, gar nicht erst nachschlagen.
 */
export function normalizeUserCode(value: string | null | undefined): string | null {
  if (!value) return null;

  const roh = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (roh.length !== USER_CODE_GROUP * USER_CODE_GROUPS) return null;
  for (const zeichen of roh) {
    if (!USER_CODE_ALPHABET.includes(zeichen)) return null;
  }

  const gruppen: string[] = [];
  for (let i = 0; i < roh.length; i += USER_CODE_GROUP) {
    gruppen.push(roh.slice(i, i + USER_CODE_GROUP));
  }
  return gruppen.join('-');
}

/** Der lange Code fürs Plugin – Base64url über 32 Zufallsbytes. */
export function createDeviceCode(): string {
  return randomBytes(DEVICE_CODE_BYTES).toString('base64url');
}

export function hashDeviceCode(code: string): string {
  return createHash('sha256').update(`klappe:device-code:${code}`).digest('base64url');
}

export function verifyDeviceCode(code: string, storedHash: string): boolean {
  const links = Buffer.from(hashDeviceCode(code));
  const rechts = Buffer.from(storedHash);
  if (links.length !== rechts.length) return false;
  return timingSafeEqual(links, rechts);
}
