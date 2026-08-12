import { describe, expect, it } from 'vitest';
import {
  type BrandProfileDto,
  brandProfileColors,
  effectiveBranding,
  normalizeBrandProfileName,
  normalizeMailFromName,
} from './brand-profiles';
import { DEFAULT_BRAND_ACCENT, deriveBrandColors } from './branding';
import type { BrandingDto } from './branding';

const workspace: BrandingDto = {
  title: 'Klappe',
  defaultLocale: 'de',
  ...deriveBrandColors('#4c8dff'),
  logoUrl: '/v1/branding/logo?v=1',
  faviconUrl: '/v1/branding/favicon?v=1',
  appIconUrl: '/v1/branding/app-icon.png?v=1',
  companyName: 'Beispiel Film GmbH',
  companyShort: 'BSP',
  updatedAt: '2026-08-12T00:00:00.000Z',
};

const auftritt: BrandProfileDto = {
  id: 'a1',
  name: 'Beispiel Agentur GmbH',
  ...deriveBrandColors('#c81e5a'),
  logoUrl: '/v1/brand-profiles/a1/logo?v=2',
  companyName: 'Beispiel Agentur GmbH',
  companyShort: 'AGT',
  mailFromName: 'Beispiel Agentur',
  projectCount: 3,
  updatedAt: '2026-08-12T00:00:00.000Z',
};

describe('effectiveBranding', () => {
  it('lässt den Workspace unverändert, wenn kein Auftritt hängt', () => {
    expect(effectiveBranding(workspace, null)).toEqual(workspace);
    expect(effectiveBranding(workspace, undefined)).toEqual(workspace);
  });

  it('setzt Titel, Farben und Logo des Auftritts durch', () => {
    const wirksam = effectiveBranding(workspace, auftritt);

    expect(wirksam.title).toBe('Beispiel Agentur GmbH');
    expect(wirksam.accent).toBe('#c81e5a');
    expect(wirksam.accentHover).toBe(auftritt.accentHover);
    expect(wirksam.accentContrast).toBe(auftritt.accentContrast);
    expect(wirksam.logoUrl).toBe('/v1/brand-profiles/a1/logo?v=2');
  });

  it('tauscht auch Firmenname und Kürzel aus', () => {
    // Sonst steht unter dem Agenturlogo ein Kommentar von „Anna Beispiel (BSP)"
    // und der Endkunde weiß, wer den Film tatsächlich gemacht hat.
    const wirksam = effectiveBranding(workspace, auftritt);

    expect(wirksam.companyName).toBe('Beispiel Agentur GmbH');
    expect(wirksam.companyShort).toBe('AGT');
  });

  it('behält Tab-Symbol, App-Symbol und Sprachvorgabe des Workspace', () => {
    const wirksam = effectiveBranding(workspace, auftritt);

    expect(wirksam.faviconUrl).toBe(workspace.faviconUrl);
    expect(wirksam.appIconUrl).toBe(workspace.appIconUrl);
    expect(wirksam.defaultLocale).toBe('de');
  });

  it('fällt auf den Standardtitel zurück, wenn der Auftritt keinen Namen trägt', () => {
    const wirksam = effectiveBranding(workspace, { ...auftritt, name: '   ' });
    expect(wirksam.title).toBe('Klappe');
  });

  it('nimmt ein fehlendes Logo als fehlend hin, statt auf unseres zurückzufallen', () => {
    // Ein Auftritt ohne Logo zeigt das Zeichen – nicht das Logo des Hauses.
    // Andernfalls stünde ausgerechnet dort unser Logo, wo es nicht hingehört.
    const wirksam = effectiveBranding(workspace, { ...auftritt, logoUrl: null });
    expect(wirksam.logoUrl).toBeNull();
  });
});

describe('brandProfileColors', () => {
  it('nimmt die Farbe des Auftritts', () => {
    expect(brandProfileColors('#c81e5a', '#4c8dff').accent).toBe('#c81e5a');
  });

  it('erbt die Farbe des Hauses, solange der Auftritt keine eigene hat', () => {
    expect(brandProfileColors(null, '#4c8dff').accent).toBe('#4c8dff');
    expect(brandProfileColors('   ', '#4c8dff').accent).toBe('#4c8dff');
  });

  it('landet beim Standard, wenn beide nichts hergeben', () => {
    expect(brandProfileColors(null, null).accent).toBe(DEFAULT_BRAND_ACCENT);
  });
});

describe('normalizeBrandProfileName', () => {
  it('räumt Leerraum auf', () => {
    expect(normalizeBrandProfileName('  Beispiel   Agentur  ')).toBe('Beispiel Agentur');
  });

  it('meldet Leeres als null', () => {
    expect(normalizeBrandProfileName('   ')).toBeNull();
    expect(normalizeBrandProfileName(null)).toBeNull();
  });

  it('kürzt zu Langes', () => {
    expect(normalizeBrandProfileName('x'.repeat(80))).toHaveLength(60);
  });
});

describe('normalizeMailFromName', () => {
  it('lässt mehr Zeichen zu als der Titel, aber nicht beliebig viele', () => {
    expect(normalizeMailFromName('x'.repeat(200))).toHaveLength(78);
  });

  it('meldet Leeres als null – dann bleibt es beim Namen des Workspace', () => {
    expect(normalizeMailFromName('')).toBeNull();
  });
});
