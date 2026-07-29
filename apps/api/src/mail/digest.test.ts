import { describe, expect, it } from 'vitest';
import { DIGEST_TOLERANCE_MS, decideDigest } from './digest';

const jetzt = 1_800_000_000_000;
const minute = 60_000;

describe('decideDigest', () => {
  it('verschickt, wenn die Ruhezeit vorbei ist', () => {
    const entscheidung = decideDigest({ newestAt: jetzt - 5 * minute, now: jetzt, minutes: 5 });
    expect(entscheidung.send).toBe(true);
  });

  it('wartet, solange gerade noch kommentiert wird', () => {
    const entscheidung = decideDigest({ newestAt: jetzt - minute, now: jetzt, minutes: 5 });
    expect(entscheidung.send).toBe(false);
    expect(entscheidung.retryInMs).toBe(4 * minute);
  });

  // Sonst reicht sich ein knapp zu früher Job endlos selbst weiter.
  it('lässt eine Winzigkeit Vorsprung durchgehen', () => {
    const entscheidung = decideDigest({
      newestAt: jetzt - 5 * minute + (DIGEST_TOLERANCE_MS - 1),
      now: jetzt,
      minutes: 5,
    });
    expect(entscheidung.send).toBe(true);
  });

  it('verschickt bei Ruhezeit 0 sofort', () => {
    expect(decideDigest({ newestAt: jetzt, now: jetzt, minutes: 0 }).send).toBe(true);
  });

  /**
   * Der Fall, der ohne Nachschlag eine Mail für immer liegen ließe: Die
   * Ruhezeit wird hochgesetzt, während der Job schon unterwegs ist.
   */
  it('schiebt nach, wenn die Ruhezeit zwischenzeitlich wächst', () => {
    const entscheidung = decideDigest({ newestAt: jetzt - 5 * minute, now: jetzt, minutes: 30 });
    expect(entscheidung.send).toBe(false);
    expect(entscheidung.retryInMs).toBe(25 * minute);
  });

  it('verschickt Liegengebliebenes beim nächsten Anlauf', () => {
    const entscheidung = decideDigest({ newestAt: jetzt - 3 * 60 * minute, now: jetzt, minutes: 5 });
    expect(entscheidung.send).toBe(true);
  });
});
