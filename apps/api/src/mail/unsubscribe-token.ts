/**
 * Abmelde-Links ohne Datenbank: Der Link trägt die Benutzer-ID und eine
 * Signatur. Damit kann jeder seine Benachrichtigungen abstellen, ohne sich
 * anzumelden – und niemand kann das für andere tun.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SEPARATOR = '.';

function sign(userId: string, secret: string): string {
  return createHmac('sha256', `klappe:unsubscribe:${secret}`).update(userId).digest('base64url');
}

export function createUnsubscribeToken(userId: string, secret: string): string {
  return `${userId}${SEPARATOR}${sign(userId, secret)}`;
}

/** Gibt die Benutzer-ID zurück oder `null`, wenn die Signatur nicht stimmt. */
export function readUnsubscribeToken(token: string | undefined, secret: string): string | null {
  if (!token) return null;
  const index = token.lastIndexOf(SEPARATOR);
  if (index <= 0) return null;

  const userId = token.slice(0, index);
  const signature = token.slice(index + 1);
  const expected = sign(userId, secret);

  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length) return null;
  return timingSafeEqual(given, wanted) ? userId : null;
}
