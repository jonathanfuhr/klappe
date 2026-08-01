import type { AiKindDto } from '@klappe/shared';
import { describe, expect, it } from 'vitest';
import { de } from '@/i18n/de';
import { en } from '@/i18n/en';
import { aiKindName } from './ai-kinds';

/** Ein Übersetzer, der schlicht im Wörterbuch nachschlägt – ohne React. */
function uebersetzer(woerterbuch: Record<string, unknown>) {
  return ((key: string) => {
    const wert = woerterbuch[key];
    return typeof wert === 'string' ? wert : key;
  }) as Parameters<typeof aiKindName>[1];
}

const t = { de: uebersetzer(de), en: uebersetzer(en) };

function art(teile: Partial<AiKindDto>): AiKindDto {
  return { id: 'a', name: 'KI-Stimme', key: 'voice', ...teile };
}

describe('aiKindName', () => {
  it('übersetzt die vier ab Werk gelieferten Arten', () => {
    const werksarten: Array<[string, string, string]> = [
      ['voice', 'KI-Stimme', 'AI voice'],
      ['video', 'KI-Video', 'AI video'],
      ['sounds', 'KI-Sounds', 'AI sounds'],
      ['music', 'KI-Musik', 'AI music'],
    ];
    for (const [key, deutsch, englisch] of werksarten) {
      expect(aiKindName(art({ key, name: deutsch }), t.de)).toBe(deutsch);
      expect(aiKindName(art({ key, name: deutsch }), t.en)).toBe(englisch);
    }
  });

  it('lässt selbst angelegte Arten unangetastet – auch auf Englisch', () => {
    const eigene = art({ key: null, name: 'Untertitel aus dem Generator' });
    expect(aiKindName(eigene, t.de)).toBe('Untertitel aus dem Generator');
    expect(aiKindName(eigene, t.en)).toBe('Untertitel aus dem Generator');
  });

  it('fällt bei unbekanntem Code auf den Namen zurück, statt den Schlüssel zu zeigen', () => {
    // Etwa, wenn eine spätere Fassung eine Art ergänzt, die dieser Stand
    // noch nicht kennt.
    const unbekannt = art({ key: 'hologramm', name: 'KI-Hologramm' });
    expect(aiKindName(unbekannt, t.en)).toBe('KI-Hologramm');
  });

  it('nimmt einen leeren Code wie keinen', () => {
    expect(aiKindName(art({ key: '', name: 'Eigene Art' }), t.en)).toBe('Eigene Art');
  });
});
