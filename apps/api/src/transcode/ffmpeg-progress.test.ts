import { describe, expect, it } from 'vitest';
import { parseProgressLine } from './ffmpeg.service';

/**
 * Die Werte stammen aus einer echten Ausgabe von `ffmpeg -progress pipe:1`
 * (ffmpeg 6.1). Wichtig dabei: `out_time_ms` enthält entgegen dem Namen
 * Mikrosekunden – dieselbe Zahl wie `out_time_us`. Der Vergleich mit
 * `out_time=00:00:00.092880` bestätigt das.
 */
describe('parseProgressLine', () => {
  it('liest out_time_us als Sekunden', () => {
    expect(parseProgressLine('out_time_us=92880')).toBeCloseTo(0.09288, 6);
    expect(parseProgressLine('out_time_us=8000000')).toBe(8);
  });

  it('behandelt out_time_ms mit demselben Maßstab', () => {
    // Beide Zeilen desselben Fortschrittsblocks führen zum selben Ergebnis.
    expect(parseProgressLine('out_time_ms=441179')).toBe(parseProgressLine('out_time_us=441179'));
  });

  it('ignoriert alle übrigen Zeilen', () => {
    for (const line of [
      'frame=25',
      'fps=24.5',
      'out_time=00:00:00.092880',
      'progress=continue',
      'progress=end',
      '',
    ]) {
      expect(parseProgressLine(line)).toBeNull();
    }
  });

  it('ignoriert den negativen Startwert vor dem ersten Bild', () => {
    // ffmpeg schreibt zu Beginn gelegentlich einen negativen Zeitstempel.
    expect(parseProgressLine('out_time_us=-23000')).toBeNull();
  });

  it('verträgt Wagenrücklauf und Leerzeichen am Zeilenende', () => {
    expect(parseProgressLine('out_time_us=1000000\r')).toBe(1);
  });
});
