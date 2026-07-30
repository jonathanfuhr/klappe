import { describe, expect, it } from 'vitest';
import {
  delayUntilWindow,
  formatMinute,
  isValidMinute,
  parseMinute,
} from './transcode-window';

/** Ortszeit, denn genau damit rechnet die Funktion. */
function um(stunde: number, minute = 0, sekunde = 0): Date {
  return new Date(2026, 6, 29, stunde, minute, sekunde);
}

const NACHTS = { startMinute: 22 * 60, endMinute: 6 * 60 };
const TAGSUEBER = { startMinute: 9 * 60, endMinute: 17 * 60 };

describe('delayUntilWindow', () => {
  it('lässt ohne Fenster sofort los', () => {
    expect(delayUntilWindow(um(14), { startMinute: null, endMinute: null })).toBe(0);
    expect(delayUntilWindow(um(14), { startMinute: 600, endMinute: null })).toBe(0);
  });

  it('lässt innerhalb des Fensters sofort los', () => {
    expect(delayUntilWindow(um(10), TAGSUEBER)).toBe(0);
    expect(delayUntilWindow(um(9), TAGSUEBER)).toBe(0);
  });

  it('wartet bis zum Beginn', () => {
    // 8:00 → eine Stunde bis 9:00
    expect(delayUntilWindow(um(8), TAGSUEBER)).toBe(60 * 60_000);
  });

  it('zählt die angebrochene Minute mit', () => {
    // 8:59:30 → noch 30 Sekunden
    expect(delayUntilWindow(um(8, 59, 30), TAGSUEBER)).toBe(30_000);
  });

  it('wartet über Nacht bis zum nächsten Tag', () => {
    // 17:00 ist gerade heraus – bis morgen 9:00 sind es 16 Stunden.
    expect(delayUntilWindow(um(17), TAGSUEBER)).toBe(16 * 60 * 60_000);
  });

  it('versteht ein Fenster über Mitternacht', () => {
    expect(delayUntilWindow(um(23), NACHTS)).toBe(0);
    expect(delayUntilWindow(um(2), NACHTS)).toBe(0);
    expect(delayUntilWindow(um(5, 59), NACHTS)).toBe(0);
    // 6:00 ist das Ende, also draußen – 16 Stunden bis 22:00.
    expect(delayUntilWindow(um(6), NACHTS)).toBe(16 * 60 * 60_000);
    expect(delayUntilWindow(um(21, 30), NACHTS)).toBe(30 * 60_000);
  });

  it('liest Start gleich Ende als „kein Fenster“, nicht als „nie“', () => {
    // Ein Tippfehler soll die Warteschlange nicht stilllegen.
    expect(delayUntilWindow(um(14), { startMinute: 600, endMinute: 600 })).toBe(0);
  });

  it('ignoriert unsinnige Werte aus der Datenbank', () => {
    expect(delayUntilWindow(um(14), { startMinute: -5, endMinute: 600 })).toBe(0);
    expect(delayUntilWindow(um(14), { startMinute: 600, endMinute: 5000 })).toBe(0);
  });
});

describe('isValidMinute', () => {
  it('nimmt 0 bis 1439', () => {
    expect(isValidMinute(0)).toBe(true);
    expect(isValidMinute(1439)).toBe(true);
    expect(isValidMinute(1440)).toBe(false);
    expect(isValidMinute(-1)).toBe(false);
    expect(isValidMinute(null)).toBe(false);
    expect(isValidMinute(12.5)).toBe(false);
  });
});

describe('formatMinute / parseMinute', () => {
  it('rechnet in beide Richtungen', () => {
    expect(formatMinute(1320)).toBe('22:00');
    expect(formatMinute(0)).toBe('00:00');
    expect(formatMinute(9 * 60 + 5)).toBe('09:05');
    expect(parseMinute('22:00')).toBe(1320);
    expect(parseMinute('9:05')).toBe(545);
  });

  it('gibt bei Unsinn null zurück', () => {
    expect(formatMinute(null)).toBeNull();
    expect(parseMinute('')).toBeNull();
    expect(parseMinute('24:00')).toBeNull();
    expect(parseMinute('12:60')).toBeNull();
    expect(parseMinute('abends')).toBeNull();
  });
});
