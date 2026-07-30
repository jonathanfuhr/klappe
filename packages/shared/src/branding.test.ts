import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRAND_ACCENT,
  DEFAULT_BRAND_TITLE,
  deriveBrandColors,
  hoverVariant,
  normalizeBrandTitle,
  normalizeHexColor,
  readableTextColor,
  relativeLuminance,
} from './branding';

describe('normalizeHexColor', () => {
  it('nimmt die lange Schreibweise mit und ohne Raute', () => {
    expect(normalizeHexColor('#AABBCC')).toBe('#aabbcc');
    expect(normalizeHexColor('aabbcc')).toBe('#aabbcc');
  });

  it('schreibt die Kurzform aus', () => {
    expect(normalizeHexColor('#abc')).toBe('#aabbcc');
    expect(normalizeHexColor('f00')).toBe('#ff0000');
  });

  it('meldet Unbrauchbares als null statt zu raten', () => {
    expect(normalizeHexColor('rot')).toBeNull();
    expect(normalizeHexColor('#12345')).toBeNull();
    expect(normalizeHexColor('#gggggg')).toBeNull();
    expect(normalizeHexColor('')).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
  });

  it('stört sich nicht an Leerzeichen', () => {
    expect(normalizeHexColor('  #4C8DFF  ')).toBe('#4c8dff');
  });
});

describe('relativeLuminance', () => {
  it('kennt die Endpunkte', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('gewichtet Grün am stärksten', () => {
    expect(relativeLuminance('#00ff00')).toBeGreaterThan(relativeLuminance('#ff0000'));
    expect(relativeLuminance('#ff0000')).toBeGreaterThan(relativeLuminance('#0000ff'));
  });
});

describe('readableTextColor', () => {
  it('setzt helle Schrift auf dunkle Farben', () => {
    expect(readableTextColor('#1c2b5e')).toBe('#ffffff');
    expect(readableTextColor('#000000')).toBe('#ffffff');
  });

  it('setzt dunkle Schrift auf helle Farben', () => {
    expect(readableTextColor('#ffe14d')).toBe('#101114');
    expect(readableTextColor('#ffffff')).toBe('#101114');
  });
});

describe('hoverVariant', () => {
  it('hellt dunkle Farben auf', () => {
    expect(relativeLuminance(hoverVariant('#1c2b5e'))).toBeGreaterThan(
      relativeLuminance('#1c2b5e'),
    );
  });

  it('dunkelt sehr helle Farben ab, statt ins Weiße zu laufen', () => {
    expect(relativeLuminance(hoverVariant('#fdfdfd'))).toBeLessThan(relativeLuminance('#fdfdfd'));
  });

  it('bleibt im gültigen Bereich', () => {
    expect(hoverVariant('#ffffff')).toMatch(/^#[0-9a-f]{6}$/);
    expect(hoverVariant('#000000')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('deriveBrandColors', () => {
  it('baut aus einer Farbe drei zusammenpassende', () => {
    const farben = deriveBrandColors('#e5484d');
    expect(farben.accent).toBe('#e5484d');
    expect(farben.accentHover).not.toBe(farben.accent);
    expect(farben.accentContrast).toBe('#ffffff');
  });

  it('fällt bei Unsinn auf die Standardfarbe zurück', () => {
    expect(deriveBrandColors('blau').accent).toBe(DEFAULT_BRAND_ACCENT);
    expect(deriveBrandColors(null).accent).toBe(DEFAULT_BRAND_ACCENT);
  });
});

describe('normalizeBrandTitle', () => {
  it('räumt Leerraum auf', () => {
    expect(normalizeBrandTitle('  Beispiel   Video  ')).toBe('Beispiel Video');
  });

  it('nimmt bei leerer Eingabe den Standard', () => {
    expect(normalizeBrandTitle('   ')).toBe(DEFAULT_BRAND_TITLE);
    expect(normalizeBrandTitle(null)).toBe(DEFAULT_BRAND_TITLE);
  });

  it('kürzt überlange Titel, statt den Kopf zu sprengen', () => {
    expect(normalizeBrandTitle('x'.repeat(200))).toHaveLength(60);
  });
});
