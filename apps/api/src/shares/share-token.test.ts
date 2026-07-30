import { describe, expect, it } from 'vitest';
import { createLoginCode, createShareToken, isLoginCodeShaped, isShareTokenShaped } from './share-token';

describe('createShareToken', () => {
  it('erzeugt Token in erwarteter Form', () => {
    for (let index = 0; index < 50; index += 1) {
      const token = createShareToken();
      expect(token).toHaveLength(24);
      expect(isShareTokenShaped(token)).toBe(true);
    }
  });

  it('vermeidet die Paare 0/o und 1/l', () => {
    const zusammen = Array.from({ length: 200 }, () => createShareToken()).join('');
    for (const zeichen of ['0', 'o', '1', 'l']) {
      expect(zusammen).not.toContain(zeichen);
    }
  });

  it('wiederholt sich nicht', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => createShareToken()));
    expect(tokens.size).toBe(500);
  });

  it('nutzt das Alphabet gleichmäßig aus', () => {
    // Zurückweisungsverfahren statt Modulo: kein Zeichen darf auffällig
    // häufiger vorkommen als der Durchschnitt.
    const zusammen = Array.from({ length: 400 }, () => createShareToken()).join('');
    const zaehler = new Map<string, number>();
    for (const zeichen of zusammen) zaehler.set(zeichen, (zaehler.get(zeichen) ?? 0) + 1);
    const werte = [...zaehler.values()];
    const mittel = zusammen.length / 32;
    expect(zaehler.size).toBe(32);
    expect(Math.max(...werte)).toBeLessThan(mittel * 1.4);
    expect(Math.min(...werte)).toBeGreaterThan(mittel * 0.6);
  });

  it('weist fremde Formen ab', () => {
    expect(isShareTokenShaped('zu-kurz')).toBe(false);
    expect(isShareTokenShaped(`${createShareToken()}x`)).toBe(false);
    expect(isShareTokenShaped('ABCDEFGHJKMNPQRSTUVWXYZ2')).toBe(false);
  });
});

describe('createLoginCode', () => {
  it('liefert immer sechs Ziffern', () => {
    for (let index = 0; index < 300; index += 1) {
      expect(isLoginCodeShaped(createLoginCode())).toBe(true);
    }
  });

  it('erkennt gültige und ungültige Eingaben', () => {
    expect(isLoginCodeShaped('000042')).toBe(true);
    expect(isLoginCodeShaped(' 123456 ')).toBe(true);
    expect(isLoginCodeShaped('12345')).toBe(false);
    expect(isLoginCodeShaped('1234567')).toBe(false);
    expect(isLoginCodeShaped('12345a')).toBe(false);
  });

  it('erzeugt unterschiedliche Codes', () => {
    const codes = new Set(Array.from({ length: 200 }, () => createLoginCode()));
    expect(codes.size).toBeGreaterThan(150);
  });
});
