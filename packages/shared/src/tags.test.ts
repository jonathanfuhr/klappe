import { describe, expect, it } from 'vitest';
import {
  MAX_TAG_NAME_LENGTH,
  TAG_COLORS,
  colorForTagName,
  isSameTagName,
  normalizeTagName,
} from './tags';

describe('normalizeTagName', () => {
  it('räumt Leerraum auf', () => {
    expect(normalizeTagName('  Imagefilm   2026 ')).toBe('Imagefilm 2026');
  });

  it('kürzt zu lange Namen', () => {
    expect(normalizeTagName('x'.repeat(200))).toHaveLength(MAX_TAG_NAME_LENGTH);
  });

  it('lässt einen leeren Namen leer – die Prüfung liegt beim Aufrufer', () => {
    expect(normalizeTagName('   ')).toBe('');
  });
});

describe('colorForTagName', () => {
  it('liefert immer dieselbe Farbe für denselben Namen', () => {
    expect(colorForTagName('Kunde THD')).toBe(colorForTagName('Kunde THD'));
  });

  it('achtet dabei nicht auf Schreibweise und Leerraum', () => {
    expect(colorForTagName('kunde thd')).toBe(colorForTagName('  Kunde   THD '));
  });

  it('bleibt in der Palette', () => {
    for (const name of ['a', 'Imagefilm', 'Social Media', 'Nachdreh 2027', 'ü']) {
      expect(TAG_COLORS).toContain(colorForTagName(name) as (typeof TAG_COLORS)[number]);
    }
  });

  it('verteilt verschiedene Namen über die Palette', () => {
    const namen = ['Imagefilm', 'Social', 'Messe', 'Recruiting', 'Kunde A', 'Kunde B', 'Intern', 'Reel'];
    const farben = new Set(namen.map(colorForTagName));
    expect(farben.size).toBeGreaterThan(2);
  });
});

describe('isSameTagName', () => {
  it('erkennt gleiche Namen trotz anderer Schreibweise', () => {
    expect(isSameTagName('Imagefilm', 'imagefilm')).toBe(true);
    expect(isSameTagName(' Social  Media ', 'social media')).toBe(true);
  });

  it('unterscheidet verschiedene Namen', () => {
    expect(isSameTagName('Imagefilm', 'Imagefilme')).toBe(false);
  });
});
