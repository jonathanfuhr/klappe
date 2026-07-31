import { describe, expect, it } from 'vitest';
import { hashPassword, validatePasswordStrength, verifyPassword } from './password';

describe('hashPassword / verifyPassword', () => {
  it('erkennt das richtige Passwort wieder', async () => {
    const hash = await hashPassword('richtig-geheim-2026');
    expect(await verifyPassword('richtig-geheim-2026', hash)).toBe(true);
  });

  it('lehnt ein falsches Passwort ab', async () => {
    const hash = await hashPassword('richtig-geheim-2026');
    expect(await verifyPassword('falsch-geheim-2026', hash)).toBe(false);
  });

  it('erzeugt für dasselbe Passwort unterschiedliche Hashes (Salt)', async () => {
    const a = await hashPassword('richtig-geheim-2026');
    const b = await hashPassword('richtig-geheim-2026');
    expect(a).not.toBe(b);
    expect(await verifyPassword('richtig-geheim-2026', b)).toBe(true);
  });

  it('schreibt die Parameter in den Hash', async () => {
    const hash = await hashPassword('richtig-geheim-2026');
    expect(hash.split('$').slice(0, 4)).toEqual(['scrypt', '16384', '8', '1']);
  });

  it('behandelt fehlende oder kaputte Hashes als Fehlschlag statt zu werfen', async () => {
    expect(await verifyPassword('egal', null)).toBe(false);
    expect(await verifyPassword('egal', '')).toBe(false);
    expect(await verifyPassword('egal', 'bcrypt$1$2$3$4$5')).toBe(false);
    expect(await verifyPassword('egal', 'scrypt$x$8$1$c2FsdA==$aGFzaA==')).toBe(false);
    expect(await verifyPassword('egal', 'scrypt$16384$8$1$$')).toBe(false);
  });

  it('normalisiert Unicode, damit gleich aussehende Eingaben gleich zählen', async () => {
    const composed = 'Caf\u00e9-Klappe-2026'; // é als ein Zeichen
    const decomposed = 'Cafe\u0301-Klappe-2026'; // e + kombinierender Akzent
    expect(composed).not.toBe(decomposed);
    const hash = await hashPassword(composed);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });
});

describe('validatePasswordStrength', () => {
  it('nimmt ausreichend lange Passwörter mit Ziffer an', () => {
    expect(validatePasswordStrength('kamera-klappe-1')).toBeNull();
  });

  it('weist zu kurze, reine Buchstaben oder überlange Passwörter zurück', () => {
    expect(validatePasswordStrength('kurz1')).toMatch(/mindestens/);
    expect(validatePasswordStrength('nurbuchstaben')).toMatch(/Ziffer/);
    expect(validatePasswordStrength(`a1${'x'.repeat(600)}`)).toMatch(/höchstens/);
  });

  /*
   * Ohne Richtlinie gelten die alten, fest verdrahteten Regeln – ein Update
   * darf kein bestehendes Passwort ungültig machen (Phase 24).
   */
  it('folgt der übergebenen Richtlinie statt fester Regeln', () => {
    const streng = {
      minLength: 14,
      requireLetter: true,
      requireDigit: true,
      requireMixedCase: true,
      requireSymbol: true,
    };
    expect(validatePasswordStrength('Kamera-Klappe-1!', streng)).toBeNull();
    expect(validatePasswordStrength('kamera-klappe-1!', streng)).toMatch(/Groß- und Klein/);
    expect(validatePasswordStrength('KameraKlappe123', streng)).toMatch(/Sonderzeichen/);
    expect(validatePasswordStrength('Kamera-1!', streng)).toMatch(/mindestens 14/);

    const locker = {
      minLength: 8,
      requireLetter: false,
      requireDigit: false,
      requireMixedCase: false,
      requireSymbol: false,
    };
    expect(validatePasswordStrength('12345678', locker)).toBeNull();
  });
});
