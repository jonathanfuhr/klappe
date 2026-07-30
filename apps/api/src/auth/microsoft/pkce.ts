/**
 * PKCE nach RFC 7636.
 *
 * Auch mit Client-Secret sinnvoll: Wird der Autorisierungscode unterwegs
 * abgefangen – etwa aus einem Logeintrag oder dem Verlauf –, nützt er ohne
 * den passenden Verifier nichts.
 */
import { createHash, randomBytes } from 'node:crypto';

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** Der Verifier ist ein Zufallswert, die Challenge sein SHA-256-Abdruck. */
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: challengeFor(verifier) };
}

export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** Zufallswert gegen untergeschobene Antworten (`state`) bzw. Wiedereinspielen (`nonce`). */
export function createRandomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
