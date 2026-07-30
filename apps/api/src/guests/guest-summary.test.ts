import { describe, expect, it } from 'vitest';
import { type GuestGrantRow, summarizeGuests } from './guest-summary';

function grant(overrides: Partial<GuestGrantRow> = {}): GuestGrantRow {
  return {
    userId: 'gast-1',
    name: 'Kunde Meier',
    email: 'kunde@example.com',
    userActive: true,
    shareLinkId: 'link-1',
    label: 'Erste Runde',
    scope: 'PROJECT',
    targetName: 'Imagefilm',
    targetId: 'projekt-1',
    isDirect: false,
    allowComments: true,
    allowDownload: false,
    allowUpload: false,
    hasOverride: false,
    linkActive: true,
    revokedAt: null,
    firstSeenAt: new Date('2026-07-01T10:00:00Z'),
    lastSeenAt: new Date('2026-07-01T10:00:00Z'),
    ...overrides,
  };
}

describe('summarizeGuests', () => {
  it('fasst mehrere Links zu einer Zeile je Gast zusammen', () => {
    const [gast] = summarizeGuests([
      grant({ shareLinkId: 'a' }),
      grant({ shareLinkId: 'b', allowDownload: true }),
    ]);

    expect(gast.links).toHaveLength(2);
    expect(gast.canDownload).toBe(true);
  });

  it('rechnet die Rechte über alle gültigen Links zusammen', () => {
    const [gast] = summarizeGuests([
      grant({ shareLinkId: 'a', allowComments: true, allowDownload: false }),
      grant({ shareLinkId: 'b', allowComments: false, allowDownload: true, allowUpload: true }),
    ]);

    expect(gast.canView).toBe(true);
    expect(gast.canComment).toBe(true);
    expect(gast.canDownload).toBe(true);
    expect(gast.canUpload).toBe(true);
  });

  it('zählt einen entzogenen Zugang nicht mit', () => {
    const [gast] = summarizeGuests([
      grant({ shareLinkId: 'a', allowDownload: true, revokedAt: new Date('2026-07-02T09:00:00Z') }),
    ]);

    expect(gast.canView).toBe(false);
    expect(gast.canDownload).toBe(false);
    expect(gast.links[0].revokedAt).toBe('2026-07-02T09:00:00.000Z');
  });

  it('zählt einen zurückgezogenen Link nicht mit', () => {
    const [gast] = summarizeGuests([grant({ linkActive: false, allowDownload: true })]);

    expect(gast.canView).toBe(false);
    expect(gast.canDownload).toBe(false);
  });

  it('sperrt das Konto, zählt gar nichts mehr', () => {
    const [gast] = summarizeGuests([
      grant({ shareLinkId: 'a', userActive: false, allowDownload: true }),
      grant({ shareLinkId: 'b', userActive: false, allowComments: true }),
    ]);

    expect(gast.isActive).toBe(false);
    expect(gast.canView).toBe(false);
    expect(gast.canComment).toBe(false);
  });

  it('ein einziger gültiger Link genügt für den Zugang', () => {
    const [gast] = summarizeGuests([
      grant({ shareLinkId: 'a', revokedAt: new Date('2026-07-02T09:00:00Z') }),
      grant({ shareLinkId: 'b' }),
    ]);

    expect(gast.canView).toBe(true);
  });

  it('nimmt den frühesten und den spätesten Zeitpunkt', () => {
    const [gast] = summarizeGuests([
      grant({
        shareLinkId: 'a',
        firstSeenAt: new Date('2026-06-01T08:00:00Z'),
        lastSeenAt: new Date('2026-06-02T08:00:00Z'),
      }),
      grant({
        shareLinkId: 'b',
        firstSeenAt: new Date('2026-07-01T08:00:00Z'),
        lastSeenAt: new Date('2026-07-20T08:00:00Z'),
      }),
    ]);

    expect(gast.firstSeenAt).toBe('2026-06-01T08:00:00.000Z');
    expect(gast.lastSeenAt).toBe('2026-07-20T08:00:00.000Z');
  });

  it('führt offene Zugänge vor entzogenen', () => {
    const [gast] = summarizeGuests([
      grant({ shareLinkId: 'entzogen', revokedAt: new Date('2026-07-02T09:00:00Z') }),
      grant({ shareLinkId: 'offen' }),
    ]);

    expect(gast.links.map((link) => link.shareLinkId)).toEqual(['offen', 'entzogen']);
  });

  it('sortiert die Gäste nach dem letzten Zugriff', () => {
    const gaeste = summarizeGuests([
      grant({ userId: 'alt', email: 'alt@example.com', lastSeenAt: new Date('2026-06-01T08:00:00Z') }),
      grant({ userId: 'neu', email: 'neu@example.com', lastSeenAt: new Date('2026-07-25T08:00:00Z') }),
    ]);

    expect(gaeste.map((gast) => gast.user.id)).toEqual(['neu', 'alt']);
  });

  it('macht aus einer leeren Liste eine leere Übersicht', () => {
    expect(summarizeGuests([])).toEqual([]);
  });

  it('trennt verschiedene Gäste sauber', () => {
    const gaeste = summarizeGuests([
      grant({ userId: 'a', email: 'a@example.com', allowDownload: true }),
      grant({ userId: 'b', email: 'b@example.com', allowDownload: false }),
    ]);

    expect(gaeste).toHaveLength(2);
    expect(gaeste.find((gast) => gast.user.id === 'a')?.canDownload).toBe(true);
    expect(gaeste.find((gast) => gast.user.id === 'b')?.canDownload).toBe(false);
  });
});
