import { describe, expect, it } from 'vitest';
import { applyMentions, tokenizeCommentBody } from './mentions';

const jonathan = { label: 'Jonathan Fuhr', userId: '11111111-1111-4111-8111-111111111111' };
const jona = { label: 'Jonathan', userId: '22222222-2222-4222-8222-222222222222' };

describe('applyMentions', () => {
  it('macht aus dem sichtbaren Namen die eindeutige Schreibweise', () => {
    const ergebnis = applyMentions('Hallo @Jonathan Fuhr, schau mal', [jonathan]);
    expect(ergebnis).toBe(`Hallo @[Jonathan Fuhr](${jonathan.userId}), schau mal`);
  });

  // Sonst verschluckt der kürzere Name den Anfang des längeren.
  it('nimmt bei zwei passenden Namen den längeren', () => {
    const ergebnis = applyMentions('@Jonathan Fuhr und @Jonathan', [jona, jonathan]);
    expect(ergebnis).toBe(
      `@[Jonathan Fuhr](${jonathan.userId}) und @[Jonathan](${jona.userId})`,
    );
  });

  it('greift nur an einer Wortgrenze', () => {
    const ergebnis = applyMentions('@Jonathans Auto', [jona]);
    expect(ergebnis).toBe('@Jonathans Auto');
  });

  it('erwischt denselben Namen mehrfach', () => {
    const ergebnis = applyMentions('@Jonathan und nochmal @Jonathan', [jona]);
    expect(ergebnis.match(/@\[Jonathan\]/g)).toHaveLength(2);
  });

  it('lässt bereits ausgezeichnete Stellen unangetastet', () => {
    const vorher = `@[Jonathan](${jona.userId}) und @Jonathan`;
    const ergebnis = applyMentions(vorher, [jona]);
    expect(ergebnis.match(/@\[Jonathan\]/g)).toHaveLength(2);
    expect(ergebnis).not.toContain('@[@[');
  });

  it('lässt einen nachträglich geänderten Namen fallen', () => {
    // Lieber kein Mention als ein falsches.
    const ergebnis = applyMentions('@Jonathan Fuh', [jonathan]);
    expect(ergebnis).toBe('@Jonathan Fuh');
  });

  it('kommt mit Sonderzeichen im Namen zurecht', () => {
    const seltsam = { label: 'A. B (Ton)', userId: '33333333-3333-4333-8333-333333333333' };
    expect(applyMentions('Hi @A. B (Ton)!', [seltsam])).toBe(
      `Hi @[A. B (Ton)](${seltsam.userId})!`,
    );
  });

  it('lässt Text ohne Erwähnung unverändert', () => {
    expect(applyMentions('Nur Text', [jonathan])).toBe('Nur Text');
    expect(applyMentions('Nur Text', [])).toBe('Nur Text');
  });

  it('trifft auch am Textende', () => {
    expect(applyMentions('Frag mal @Jonathan', [jona])).toBe(
      `Frag mal @[Jonathan](${jona.userId})`,
    );
  });
});
