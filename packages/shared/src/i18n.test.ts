import { describe, expect, it } from 'vitest';
import { createTranslator, negotiateLocale, resolveLocale } from './i18n';

const de = {
  gruss: 'Hallo {name}',
  projekte: { one: '{count} Projekt', other: '{count} Projekte' },
  nurDeutsch: 'Nur hier',
};
const en = {
  gruss: 'Hello {name}',
  projekte: { one: '{count} project', other: '{count} projects' },
};

describe('createTranslator', () => {
  it('setzt Platzhalter ein', () => {
    const t = createTranslator(en, de);
    expect(t('gruss', { name: 'Anna' })).toBe('Hello Anna');
  });

  it('waehlt Einzahl und Mehrzahl nach count', () => {
    const t = createTranslator(de, de);
    expect(t('projekte', { count: 1 })).toBe('1 Projekt');
    expect(t('projekte', { count: 3 })).toBe('3 Projekte');
    expect(t('projekte', { count: 0 })).toBe('0 Projekte');
  });

  /* Ein vergessener Schluessel soll sichtbar sein, nicht leer. */
  it('faellt auf die Quellsprache zurueck, sonst auf den Schluessel', () => {
    const t = createTranslator(en, de);
    expect(t('nurDeutsch')).toBe('Nur hier');
    expect(t('gibtEsNicht')).toBe('gibtEsNicht');
  });

  it('laesst unbekannte Platzhalter stehen', () => {
    const t = createTranslator(de, de);
    expect(t('gruss')).toBe('Hallo {name}');
  });
});

describe('negotiateLocale', () => {
  it('nimmt die hoechstgewichtete bekannte Sprache', () => {
    expect(negotiateLocale('fr;q=0.9,en;q=0.8,de;q=0.7')).toBe('en');
    expect(negotiateLocale('de-AT,de;q=0.9')).toBe('de');
  });

  it('gibt null zurueck, wenn nichts passt', () => {
    expect(negotiateLocale('fr,es')).toBeNull();
    expect(negotiateLocale('')).toBeNull();
    expect(negotiateLocale(null)).toBeNull();
  });
});

describe('resolveLocale', () => {
  it('haelt sich an die Reihenfolge eigene, Workspace, Browser, Deutsch', () => {
    expect(resolveLocale('en', 'de', 'fr')).toBe('en');
    expect(resolveLocale(null, 'en', 'de')).toBe('en');
    expect(resolveLocale(null, null, 'en-GB')).toBe('en');
    expect(resolveLocale(null, null, null)).toBe('de');
    // Unsinn in der Datenbank darf nicht durchschlagen.
    expect(resolveLocale('klingonisch', null, null)).toBe('de');
  });
});
