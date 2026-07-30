import { describe, expect, it } from 'vitest';
import { MAX_COMPANY_SHORT_LENGTH, displayUserName, normalizeCompanyText } from './company';

describe('normalizeCompanyText', () => {
  it('räumt Leerraum auf', () => {
    expect(normalizeCompanyText('  Beispiel   Medien  ', 120)).toBe('Beispiel Medien');
  });

  it('macht aus nichts null', () => {
    expect(normalizeCompanyText('   ', 120)).toBeNull();
    expect(normalizeCompanyText('', 120)).toBeNull();
    expect(normalizeCompanyText(null, 120)).toBeNull();
    expect(normalizeCompanyText(undefined, 120)).toBeNull();
  });

  it('kürzt auf die Höchstlänge', () => {
    expect(normalizeCompanyText('ABCDEFGHIJKLMNOP', MAX_COMPANY_SHORT_LENGTH)).toBe('ABCDEFGHIJKL');
  });
});

describe('displayUserName', () => {
  it('hängt das Kürzel an Namen des eigenen Teams', () => {
    expect(displayUserName('Anna Meier', 'MEMBER', 'BSP')).toBe('Anna Meier (BSP)');
    expect(displayUserName('Anna Meier', 'ADMIN', 'BSP')).toBe('Anna Meier (BSP)');
  });

  it('lässt Gäste in Ruhe – deren Haus ist ein anderes', () => {
    expect(displayUserName('Klaus Kunde', 'GUEST', 'BSP')).toBe('Klaus Kunde');
  });

  it('bleibt beim Namen, wenn kein Kürzel hinterlegt ist', () => {
    expect(displayUserName('Anna Meier', 'MEMBER', null)).toBe('Anna Meier');
    expect(displayUserName('Anna Meier', 'MEMBER', '   ')).toBe('Anna Meier');
  });

  it('verdoppelt ein schon getipptes Kürzel nicht', () => {
    expect(displayUserName('Anna Meier (BSP)', 'MEMBER', 'BSP')).toBe('Anna Meier (BSP)');
    expect(displayUserName('Anna Meier (bsp)', 'MEMBER', 'BSP')).toBe('Anna Meier (bsp)');
  });

  it('kommt mit fehlendem Namen und fehlender Rolle zurecht', () => {
    expect(displayUserName('', 'MEMBER', 'BSP')).toBe('');
    expect(displayUserName('Anna Meier', null, 'BSP')).toBe('Anna Meier');
    expect(displayUserName('Anna Meier', undefined, 'BSP')).toBe('Anna Meier');
  });
});
