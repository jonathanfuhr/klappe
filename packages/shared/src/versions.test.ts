import { describe, expect, it } from 'vitest';
import {
  checkVersionNumber,
  formatVersionNumber,
  nextVersionNumber,
  versionForFilename,
  versionLabel,
} from './versions';

describe('formatVersionNumber', () => {
  it('lässt überflüssige Nullen weg', () => {
    expect(formatVersionNumber(2)).toBe('2');
    expect(formatVersionNumber(2.0)).toBe('2');
  });

  it('behält echte Nachkommastellen', () => {
    expect(formatVersionNumber(2.5)).toBe('2.5');
    expect(formatVersionNumber(1.25)).toBe('1.25');
  });

  it('rundet auf drei Stellen', () => {
    expect(formatVersionNumber(1.23456)).toBe('1.235');
  });
});

describe('versionForFilename', () => {
  // Ein Punkt sähe im Dateinamen wie eine Endung aus.
  it('ersetzt den Punkt durch einen Bindestrich', () => {
    expect(versionForFilename(2.5)).toBe('v2-5');
    expect(versionForFilename(3)).toBe('v3');
  });
});

describe('checkVersionNumber', () => {
  it('nimmt eine Zwischenfassung an', () => {
    const ergebnis = checkVersionNumber(2.5, [1, 2]);
    expect(ergebnis.ok).toBe(true);
    expect(ergebnis.ok && ergebnis.value).toBe(2.5);
  });

  it('lehnt eine schon vergebene Nummer ab', () => {
    const ergebnis = checkVersionNumber(2, [1, 2]);
    expect(ergebnis.ok).toBe(false);
    expect(!ergebnis.ok && ergebnis.reason).toBe('vergeben');
  });

  it('lehnt eine Nummer unter der höchsten ab', () => {
    const ergebnis = checkVersionNumber(1.5, [1, 2]);
    expect(ergebnis.ok).toBe(false);
    expect(!ergebnis.ok && ergebnis.reason).toBe('zu-klein');
    expect(!ergebnis.ok && ergebnis.message).toContain('v2');
  });

  it('nennt die höchste Nummer in der Meldung', () => {
    const ergebnis = checkVersionNumber(2, [1, 2.5]);
    expect(!ergebnis.ok && ergebnis.message).toContain('v2.5');
  });

  it('lehnt null und negative Werte ab', () => {
    expect(checkVersionNumber(0, []).ok).toBe(false);
    expect(checkVersionNumber(-1, []).ok).toBe(false);
  });

  it('lehnt unsinnige Eingaben ab', () => {
    expect(checkVersionNumber(Number.NaN, []).ok).toBe(false);
    expect(checkVersionNumber(Number.POSITIVE_INFINITY, []).ok).toBe(false);
  });

  it('lässt die erste Fassung mit jeder Nummer zu', () => {
    expect(checkVersionNumber(1, []).ok).toBe(true);
    expect(checkVersionNumber(7.5, []).ok).toBe(true);
  });

  // 2.0000001 und 2 landen beide als 2.000 in der Spalte.
  it('vergleicht auf drei Stellen gerundet', () => {
    const ergebnis = checkVersionNumber(2.0000001, [2]);
    expect(ergebnis.ok).toBe(false);
    expect(!ergebnis.ok && ergebnis.reason).toBe('vergeben');
  });
});

describe('nextVersionNumber', () => {
  it('schlägt die nächste ganze Zahl vor', () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber([1, 2])).toBe(3);
  });

  it('springt über eine Zwischenfassung hinweg auf die nächste ganze Zahl', () => {
    expect(nextVersionNumber([1, 2, 2.5])).toBe(3);
  });
});

describe('versionLabel', () => {
  it('setzt das v davor', () => {
    expect(versionLabel(2.5)).toBe('v2.5');
  });
});
