import { describe, expect, it } from 'vitest';
import { de } from './de';
import { en } from './en';

/**
 * Die Wörterbücher gegeneinander (Phase 26).
 *
 * Ein fehlender englischer Eintrag bricht schon den Typecheck – `en` ist als
 * `Record<MessageKey, Message>` typisiert. Was der Typecheck **nicht** sieht:
 * ein Eintrag, den nur Englisch trägt (dann fehlt der deutsche Rückfall), ein
 * versehentlich leerer Text, und Platzhalter, die auf einer Seite fehlen –
 * `{count}` im Deutschen und nicht im Englischen fällt sonst erst dem
 * englischen Leser auf, dem eine Zahl im Satz fehlt.
 */
const PLATZHALTER = /\{(\w+)\}/g;

function texte(wert: unknown): string[] {
  if (typeof wert === 'string') return [wert];
  const form = wert as { one?: string; other?: string };
  return [form.one, form.other].filter((t): t is string => typeof t === 'string');
}

function platzhalter(wert: unknown): Set<string> {
  const namen = new Set<string>();
  for (const text of texte(wert)) {
    for (const treffer of text.matchAll(PLATZHALTER)) namen.add(treffer[1]);
  }
  return namen;
}

describe('Wörterbücher', () => {
  it('tragen dieselben Schlüssel', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
  });

  it('haben nirgends einen leeren Text', () => {
    for (const [woerterbuch, name] of [
      [de, 'de'],
      [en, 'en'],
    ] as const) {
      for (const [schluessel, wert] of Object.entries(woerterbuch)) {
        for (const text of texte(wert)) {
          expect(text.trim(), `${name}: „${schluessel}"`).not.toBe('');
        }
      }
    }
  });

  it('verwenden beidseitig dieselben Platzhalter', () => {
    for (const schluessel of Object.keys(de) as Array<keyof typeof de>) {
      const deutsch = [...platzhalter(de[schluessel])].sort();
      const englisch = [...platzhalter(en[schluessel])].sort();
      expect(englisch, `„${schluessel}"`).toEqual(deutsch);
    }
  });

  it('führen die Mehrzahl auf beiden Seiten', () => {
    for (const schluessel of Object.keys(de) as Array<keyof typeof de>) {
      const deutschIstForm = typeof de[schluessel] === 'object';
      const englischIstForm = typeof en[schluessel] === 'object';
      expect(englischIstForm, `„${schluessel}"`).toBe(deutschIstForm);
    }
  });
});
