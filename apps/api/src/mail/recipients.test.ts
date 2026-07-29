import { describe, expect, it } from 'vitest';
import {
  type NotificationCandidate,
  formatBytes,
  selectCommentRecipients,
  selectTeamRecipients,
} from './recipients';

const person = (id: string, overrides: Partial<NotificationCandidate> = {}): NotificationCandidate => ({
  id,
  name: id,
  email: `${id}@example.com`,
  isActive: true,
  notificationsEnabled: true,
  ...overrides,
});

describe('selectCommentRecipients', () => {
  it('benachrichtigt Beteiligte und Erwähnte', () => {
    const result = selectCommentRecipients({
      authorId: 'autor',
      mentioned: [person('anna')],
      participants: [person('ben')],
    });
    expect(result.map((entry) => entry.id).sort()).toEqual(['anna', 'ben']);
  });

  it('lässt den Verfasser aus', () => {
    const result = selectCommentRecipients({
      authorId: 'autor',
      mentioned: [person('autor')],
      participants: [person('autor'), person('ben')],
    });
    expect(result.map((entry) => entry.id)).toEqual(['ben']);
  });

  it('schickt bei Erwähnung *und* Beteiligung nur eine Mail, und zwar die für die Erwähnung', () => {
    const result = selectCommentRecipients({
      authorId: 'autor',
      mentioned: [person('anna')],
      participants: [person('anna')],
    });
    expect(result).toHaveLength(1);
    expect(result[0].mentioned).toBe(true);
  });

  it('achtet auf abbestellte Benachrichtigungen – auch bei Erwähnung', () => {
    const result = selectCommentRecipients({
      authorId: 'autor',
      mentioned: [person('anna', { notificationsEnabled: false })],
      participants: [person('ben', { notificationsEnabled: false })],
    });
    expect(result).toEqual([]);
  });

  it('lässt gesperrte Konten aus', () => {
    const result = selectCommentRecipients({
      authorId: 'autor',
      mentioned: [],
      participants: [person('ben', { isActive: false })],
    });
    expect(result).toEqual([]);
  });

  it('nennt jede Person nur einmal, auch bei mehrfacher Beteiligung', () => {
    const result = selectCommentRecipients({
      authorId: 'autor',
      mentioned: [],
      participants: [person('ben'), person('ben'), person('ben')],
    });
    expect(result).toHaveLength(1);
  });

  it('liefert für einen Kommentar ohne Beteiligte nichts', () => {
    expect(selectCommentRecipients({ authorId: 'autor', mentioned: [], participants: [] })).toEqual([]);
  });

  // Phase 18: Fürs Team entscheidet die Spalte „Benachrichtigungen“.
  it('benachrichtigt, wer den Film eingetragen hat', () => {
    const result = selectCommentRecipients({
      authorId: 'autor',
      mentioned: [],
      subscribers: [person('chef')],
      participants: [],
    });
    expect(result.map((entry) => entry.id)).toEqual(['chef']);
  });

  it('schickt einer eingetragenen *und* erwähnten Person eine Mail für die Erwähnung', () => {
    const result = selectCommentRecipients({
      authorId: 'autor',
      mentioned: [person('chef')],
      subscribers: [person('chef')],
      participants: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0].mentioned).toBe(true);
  });

  it('lässt eine eingetragene Person aus, die abbestellt hat', () => {
    const result = selectCommentRecipients({
      authorId: 'autor',
      mentioned: [],
      subscribers: [person('chef', { notificationsEnabled: false })],
      participants: [],
    });
    expect(result).toEqual([]);
  });

  it('schweigt auch den Eingetragenen gegenüber, wenn er selbst kommentiert', () => {
    const result = selectCommentRecipients({
      authorId: 'chef',
      mentioned: [],
      subscribers: [person('chef')],
      participants: [],
    });
    expect(result).toEqual([]);
  });

  it('nennt Gast und Eingetragenen zusammen, jeden einmal', () => {
    const result = selectCommentRecipients({
      authorId: 'autor',
      mentioned: [],
      subscribers: [person('chef'), person('gast')],
      participants: [person('gast')],
    });
    expect(result.map((entry) => entry.id).sort()).toEqual(['chef', 'gast']);
  });
});

describe('selectTeamRecipients', () => {
  it('informiert das Team, aber nicht die hochladende Person', () => {
    const result = selectTeamRecipients([person('admin'), person('kunde')], 'kunde');
    expect(result.map((entry) => entry.id)).toEqual(['admin']);
  });

  it('achtet auf abbestellte Benachrichtigungen und gesperrte Konten', () => {
    const result = selectTeamRecipients(
      [person('a', { notificationsEnabled: false }), person('b', { isActive: false }), person('c')],
      null,
    );
    expect(result.map((entry) => entry.id)).toEqual(['c']);
  });
});

describe('formatBytes', () => {
  it('formatiert mit deutschem Dezimalkomma', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2_516_582)).toBe('2,4 MB');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('–');
  });
});
