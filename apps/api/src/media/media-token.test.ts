import { describe, expect, it } from 'vitest';
import { createMediaToken, readMediaToken } from './media-token';

const SECRET = 'geheim-geheim-geheim-geheim-0123';
const BASIS = {
  versionId: '11111111-1111-4111-8111-111111111111',
  kind: 'proxy' as const,
  userId: '22222222-2222-4222-8222-222222222222',
};
const JETZT = 1_800_000_000_000;

describe('Medien-Token', () => {
  it('liest zurück, was hineingeschrieben wurde', () => {
    const token = createMediaToken(BASIS, SECRET, JETZT);
    const gelesen = readMediaToken(token, SECRET, JETZT);

    expect(gelesen?.versionId).toBe(BASIS.versionId);
    expect(gelesen?.kind).toBe('proxy');
    expect(gelesen?.userId).toBe(BASIS.userId);
  });

  it('lehnt eine veränderte Version ab', () => {
    const token = createMediaToken(BASIS, SECRET, JETZT);
    const gefaelscht = token.replace(BASIS.versionId, '33333333-3333-4333-8333-333333333333');

    expect(readMediaToken(gefaelscht, SECRET, JETZT)).toBeNull();
  });

  it('lehnt eine veränderte Art ab – ein Proxy-Link gibt kein Original her', () => {
    const token = createMediaToken(BASIS, SECRET, JETZT);
    expect(readMediaToken(token.replace('.proxy.', '.original.'), SECRET, JETZT)).toBeNull();
  });

  it('lehnt einen fremden Benutzer ab', () => {
    const token = createMediaToken(BASIS, SECRET, JETZT);
    expect(
      readMediaToken(token.replace(BASIS.userId, '44444444-4444-4444-8444-444444444444'), SECRET, JETZT),
    ).toBeNull();
  });

  it('lehnt ein verlängertes Ablaufdatum ab', () => {
    const token = createMediaToken({ ...BASIS, ttlSeconds: 60 }, SECRET, JETZT);
    const teile = token.split('.');
    teile[3] = String(Number(teile[3]) + 100_000);

    expect(readMediaToken(teile.join('.'), SECRET, JETZT)).toBeNull();
  });

  it('lehnt einen abgelaufenen Token ab', () => {
    const token = createMediaToken({ ...BASIS, ttlSeconds: 60 }, SECRET, JETZT);

    expect(readMediaToken(token, SECRET, JETZT + 59_000)).not.toBeNull();
    expect(readMediaToken(token, SECRET, JETZT + 61_000)).toBeNull();
  });

  it('lehnt einen mit anderem Schlüssel signierten Token ab', () => {
    const token = createMediaToken(BASIS, SECRET, JETZT);
    expect(readMediaToken(token, 'ein-anderes-geheimnis-0123456789', JETZT)).toBeNull();
  });

  it('verträgt Unsinn, ohne zu werfen', () => {
    for (const unsinn of ['', 'abc', 'a.b.c', 'a.b.c.d.e.f', 'x.proxy.y.nichtszahl.sig']) {
      expect(readMediaToken(unsinn, SECRET, JETZT)).toBeNull();
    }
    expect(readMediaToken(undefined, SECRET, JETZT)).toBeNull();
    expect(readMediaToken(null, SECRET, JETZT)).toBeNull();
  });

  it('kennt nur die vorgesehenen Arten', () => {
    const token = createMediaToken(BASIS, SECRET, JETZT);
    expect(readMediaToken(token.replace('.proxy.', '.geheimes.'), SECRET, JETZT)).toBeNull();
  });

  it('erzeugt für jede Art einen eigenen Token', () => {
    const proxy = createMediaToken(BASIS, SECRET, JETZT);
    const original = createMediaToken({ ...BASIS, kind: 'original' }, SECRET, JETZT);
    expect(proxy).not.toBe(original);
  });
});
