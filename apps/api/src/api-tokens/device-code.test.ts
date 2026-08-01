import { describe, expect, it } from 'vitest';
import {
  createDeviceCode,
  createUserCode,
  hashDeviceCode,
  normalizeUserCode,
  verifyDeviceCode,
} from './device-code';

describe('Benutzercode der Gerätekopplung', () => {
  it('hat die Form ABCD-EFGH', () => {
    expect(createUserCode()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('enthält keine Zeichen, die sich beim Abtippen verwechseln lassen', () => {
    // 100 Codes reichen, um ein verbotenes Zeichen im Alphabet aufzudecken.
    for (let i = 0; i < 100; i += 1) {
      expect(createUserCode()).not.toMatch(/[ILO01]/);
    }
  });

  it('verzeiht Kleinschreibung, fehlenden Bindestrich und Leerzeichen', () => {
    expect(normalizeUserCode('khfp-3rtm')).toBe('KHFP-3RTM');
    expect(normalizeUserCode('KHFP3RTM')).toBe('KHFP-3RTM');
    expect(normalizeUserCode(' khfp 3rtm ')).toBe('KHFP-3RTM');
  });

  it('weist ab, was gar kein Code sein kann', () => {
    expect(normalizeUserCode('')).toBeNull();
    expect(normalizeUserCode(null)).toBeNull();
    expect(normalizeUserCode('KHFP-3RT')).toBeNull();
    expect(normalizeUserCode('KHFP-3RTMM')).toBeNull();
    // `I`, `L` und `O` gehören nicht zum Alphabet – wer sie tippt, meinte
    // etwas anderes, und ein Treffer wäre reiner Zufall.
    expect(normalizeUserCode('KHFP-3RTI')).toBeNull();
  });

  it('gibt einen erzeugten Code unverändert zurück', () => {
    const code = createUserCode();
    expect(normalizeUserCode(code)).toBe(code);
  });
});

describe('Gerätecode', () => {
  it('ist lang genug, dass ihn niemand rät', () => {
    // 32 Zufallsbytes als Base64url: 43 Zeichen.
    expect(createDeviceCode().length).toBeGreaterThanOrEqual(43);
  });

  it('prüft sich gegen seinen Hash', () => {
    const code = createDeviceCode();
    expect(verifyDeviceCode(code, hashDeviceCode(code))).toBe(true);
  });

  it('lehnt einen fremden Code ab', () => {
    const code = createDeviceCode();
    expect(verifyDeviceCode(createDeviceCode(), hashDeviceCode(code))).toBe(false);
  });

  it('legt den Code nicht im Hash ab', () => {
    const code = createDeviceCode();
    expect(hashDeviceCode(code)).not.toContain(code);
  });

  it('zieht jedes Mal einen anderen', () => {
    expect(createDeviceCode()).not.toBe(createDeviceCode());
  });
});
