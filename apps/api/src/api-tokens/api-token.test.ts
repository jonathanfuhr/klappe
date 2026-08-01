import { describe, expect, it } from 'vitest';
import {
  API_TOKEN_PREFIX,
  createApiToken,
  hashApiTokenSecret,
  isApiTokenShaped,
  maskApiToken,
  parseApiToken,
  verifyApiTokenSecret,
} from './api-token';

describe('API-Token', () => {
  it('erzeugt einen Token, der sich wieder in seine zwei Teile zerlegen lässt', () => {
    const neu = createApiToken();
    const teile = parseApiToken(neu.plaintext);

    expect(teile?.selector).toBe(neu.selector);
    expect(verifyApiTokenSecret(teile?.secret as string, neu.secretHash)).toBe(true);
  });

  it('speichert das Geheimnis nirgends im Klartext', () => {
    const neu = createApiToken();
    const geheimnis = parseApiToken(neu.plaintext)?.secret as string;

    // Der Hash darf das Geheimnis nicht enthalten – sonst wäre er keiner.
    expect(neu.secretHash).not.toContain(geheimnis);
    expect(neu.secretHash).not.toBe(geheimnis);
  });

  it('erkennt einen fremden Token an der fehlenden Vorsilbe', () => {
    expect(isApiTokenShaped('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def')).toBe(false);
    expect(isApiTokenShaped(createApiToken().plaintext)).toBe(true);
    expect(isApiTokenShaped(null)).toBe(false);
  });

  it('lehnt ein verändertes Geheimnis ab', () => {
    const neu = createApiToken();
    const geheimnis = parseApiToken(neu.plaintext)?.secret as string;
    const gefaelscht = `${geheimnis.slice(0, -1)}${geheimnis.endsWith('a') ? 'b' : 'a'}`;

    expect(verifyApiTokenSecret(gefaelscht, neu.secretHash)).toBe(false);
  });

  it('lehnt einen Token ab, dessen Länge nicht stimmt – ohne nachzuschlagen', () => {
    expect(parseApiToken(`${API_TOKEN_PREFIX}kurz_zukurz`)).toBeNull();
    expect(parseApiToken(`${API_TOKEN_PREFIX}ohnetrenner`)).toBeNull();
    expect(parseApiToken('ganz_woanders_her')).toBeNull();
  });

  it('zieht zweimal hintereinander verschiedene Tokens', () => {
    const a = createApiToken();
    const b = createApiToken();

    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.selector).not.toBe(b.selector);
  });

  it('hasht wiederholbar – sonst gälte kein einziger gespeicherter Token', () => {
    expect(hashApiTokenSecret('immer-dasselbe')).toBe(hashApiTokenSecret('immer-dasselbe'));
    expect(hashApiTokenSecret('a')).not.toBe(hashApiTokenSecret('b'));
  });

  it('maskiert so, dass sich der Token nicht rekonstruieren lässt', () => {
    const neu = createApiToken();
    const maskiert = maskApiToken(neu.selector);

    expect(maskiert.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(maskiert.length).toBeLessThan(neu.plaintext.length / 2);
    expect(neu.plaintext).not.toBe(maskiert);
  });
});
