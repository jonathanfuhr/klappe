import { describe, expect, it } from 'vitest';
import {
  commentBodyToPlainText,
  mentionedUserIds,
  parseMentions,
  serializeMention,
  tokenizeCommentBody,
} from './mentions';

const ANNA = '3f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b';
const BEN = 'aaaabbbb-cccc-4ddd-8eee-ffff00001111';

describe('parseMentions', () => {
  it('findet Mentions samt Position', () => {
    const body = `Hallo @[Anna Meier](${ANNA}), bitte anschauen.`;
    const mentions = parseMentions(body);
    expect(mentions).toHaveLength(1);
    expect(mentions[0].label).toBe('Anna Meier');
    expect(mentions[0].userId).toBe(ANNA);
    expect(body.slice(mentions[0].start, mentions[0].end)).toBe(`@[Anna Meier](${ANNA})`);
  });

  it('findet mehrere Mentions', () => {
    const body = `@[Anna](${ANNA}) und @[Ben](${BEN})`;
    expect(parseMentions(body).map((m) => m.label)).toEqual(['Anna', 'Ben']);
  });

  it('ignoriert einfache @-Zeichen und kaputte Tokens', () => {
    expect(parseMentions('Frag mal @anna per Mail: anna@example.com')).toEqual([]);
    expect(parseMentions('@[Anna](keine-uuid)')).toEqual([]);
    expect(parseMentions('@[Anna]()')).toEqual([]);
    expect(parseMentions(`@[](${ANNA})`)).toEqual([]);
  });

  it('normalisiert die ID auf Kleinschreibung', () => {
    expect(parseMentions(`@[Anna](${ANNA.toUpperCase()})`)[0].userId).toBe(ANNA);
  });
});

describe('mentionedUserIds', () => {
  it('liefert jede ID nur einmal', () => {
    const body = `@[Anna](${ANNA}) … @[Anna Meier](${ANNA}) … @[Ben](${BEN})`;
    expect(mentionedUserIds(body)).toEqual([ANNA, BEN]);
  });

  it('liefert eine leere Liste ohne Mentions', () => {
    expect(mentionedUserIds('Nur Text')).toEqual([]);
  });
});

describe('tokenizeCommentBody', () => {
  it('trennt Text und Mentions in der richtigen Reihenfolge', () => {
    const body = `Hallo @[Anna](${ANNA}), Frame passt.`;
    expect(tokenizeCommentBody(body)).toEqual([
      { type: 'text', value: 'Hallo ' },
      { type: 'mention', userId: ANNA, label: 'Anna' },
      { type: 'text', value: ', Frame passt.' },
    ]);
  });

  it('kommt mit Mention am Anfang und am Ende klar', () => {
    expect(tokenizeCommentBody(`@[Anna](${ANNA})`)).toEqual([
      { type: 'mention', userId: ANNA, label: 'Anna' },
    ]);
  });

  it('gibt reinen Text unverändert zurück', () => {
    expect(tokenizeCommentBody('Nur Text')).toEqual([{ type: 'text', value: 'Nur Text' }]);
    expect(tokenizeCommentBody('')).toEqual([]);
  });
});

describe('commentBodyToPlainText', () => {
  it('macht aus Tokens lesbare Namen', () => {
    expect(commentBodyToPlainText(`Hallo @[Anna Meier](${ANNA})!`)).toBe('Hallo @Anna Meier!');
  });
});

describe('serializeMention', () => {
  it('baut ein Token, das der Parser wieder versteht', () => {
    const token = serializeMention({ id: ANNA, name: 'Anna Meier' });
    expect(token).toBe(`@[Anna Meier](${ANNA})`);
    expect(mentionedUserIds(token)).toEqual([ANNA]);
  });

  it('entschärft Zeichen, die das Format zerlegen würden', () => {
    const token = serializeMention({ id: ANNA, name: 'Anna]\nMeier' });
    expect(mentionedUserIds(token)).toEqual([ANNA]);
    expect(parseMentions(token)[0].label).toBe('Anna  Meier');
  });

  it('fängt einen leeren Namen ab', () => {
    expect(serializeMention({ id: ANNA, name: '   ' })).toBe(`@[Unbenannt](${ANNA})`);
  });
});
