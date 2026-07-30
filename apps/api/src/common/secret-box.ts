/**
 * Kleine Verschlüsselung für Geheimnisse, die in der Datenbank liegen müssen
 * und im Klartext gebraucht werden – aktuell das SMTP-Passwort.
 *
 * Der Schlüssel wird aus `JWT_SECRET` abgeleitet. Das heißt zugleich: Wer das
 * Secret wechselt, muss das SMTP-Passwort neu eintragen. Das ist der bewusste
 * Preis dafür, keine zweite Geheimnisverwaltung einzuführen.
 *
 * Verfahren: AES-256-GCM mit zufälliger Nonce, Format
 * `v1.<nonce>.<ciphertext>.<tag>` (jeweils Base64url).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const NONCE_BYTES = 12;

function deriveKey(secret: string): Buffer {
  // Fester Zusatz, damit derselbe Schlüssel nicht zufällig anderswo entsteht.
  return createHash('sha256').update(`klappe:secret-box:${secret}`).digest();
}

function toBase64Url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

export function encryptSecret(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, toBase64Url(nonce), toBase64Url(ciphertext), toBase64Url(tag)].join('.');
}

/**
 * Gibt `null` zurück, wenn der Wert nicht entschlüsselt werden kann – etwa
 * weil `JWT_SECRET` gewechselt wurde. Der Aufrufer behandelt das wie ein
 * fehlendes Passwort, statt beim Mailversand zu stolpern.
 */
export function decryptSecret(value: string | null | undefined, secret: string): string | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const key = deriveKey(secret);
    const nonce = Buffer.from(parts[1], 'base64url');
    const ciphertext = Buffer.from(parts[2], 'base64url');
    const tag = Buffer.from(parts[3], 'base64url');
    if (nonce.length !== NONCE_BYTES || tag.length !== 16) return null;

    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
