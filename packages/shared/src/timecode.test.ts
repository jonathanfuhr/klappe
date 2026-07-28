import { describe, expect, it } from 'vitest';
import {
  FPS_25,
  FPS_2997,
  displayTimecodeToFrame,
  durationToFrameCount,
  formatDuration,
  frameToDisplayTimecode,
  frameToSeekTime,
  framesToSeconds,
  framesToTimecode,
  makeFrameRate,
  nominalFps,
  parseFrameRate,
  secondsToFrames,
  supportsDropFrame,
  timecodeToFrames,
} from './timecode';

const FPS_24 = makeFrameRate(24, 1);
const FPS_2398 = makeFrameRate(24000, 1001);
const FPS_5994 = makeFrameRate(60000, 1001);

describe('parseFrameRate', () => {
  it('liest Brüche aus ffprobe', () => {
    expect(parseFrameRate('30000/1001')).toEqual({ num: 30000, den: 1001 });
    expect(parseFrameRate('25/1')).toEqual({ num: 25, den: 1 });
  });

  it('stellt die exakten NTSC-Brüche aus gerundeten Dezimalzahlen her', () => {
    expect(parseFrameRate('29.97')).toEqual({ num: 30000, den: 1001 });
    expect(parseFrameRate('23.976')).toEqual({ num: 24000, den: 1001 });
    expect(parseFrameRate('59.94')).toEqual({ num: 60000, den: 1001 });
  });

  it('gibt null für Unbrauchbares zurück', () => {
    expect(parseFrameRate('0/0')).toBeNull();
    expect(parseFrameRate('')).toBeNull();
    expect(parseFrameRate(null)).toBeNull();
    expect(parseFrameRate('N/A')).toBeNull();
  });
});

describe('nominalFps / supportsDropFrame', () => {
  it('zählt NTSC-Raten in ganzen Schritten', () => {
    expect(nominalFps(FPS_2997)).toBe(30);
    expect(nominalFps(FPS_2398)).toBe(24);
  });

  it('erlaubt Drop-Frame nur bei 29,97 und 59,94', () => {
    expect(supportsDropFrame(FPS_2997)).toBe(true);
    expect(supportsDropFrame(FPS_5994)).toBe(true);
    expect(supportsDropFrame(FPS_25)).toBe(false);
    expect(supportsDropFrame(FPS_24)).toBe(false);
    expect(supportsDropFrame(makeFrameRate(30, 1))).toBe(false);
  });
});

describe('framesToTimecode – Non-Drop', () => {
  it('zählt bei 25 fps geradlinig', () => {
    expect(framesToTimecode(0, FPS_25)).toBe('00:00:00:00');
    expect(framesToTimecode(24, FPS_25)).toBe('00:00:00:24');
    expect(framesToTimecode(25, FPS_25)).toBe('00:00:01:00');
    expect(framesToTimecode(1500, FPS_25)).toBe('00:01:00:00');
    expect(framesToTimecode(90000, FPS_25)).toBe('01:00:00:00');
  });

  it('zählt 23,976 in 24er-Schritten', () => {
    expect(framesToTimecode(24, FPS_2398)).toBe('00:00:01:00');
  });

  it('stellt negative Frames mit Vorzeichen dar', () => {
    expect(framesToTimecode(-25, FPS_25)).toBe('-00:00:01:00');
  });
});

describe('framesToTimecode – Drop-Frame', () => {
  it('überspringt die Frame-Nummern 0 und 1 zur vollen Minute', () => {
    expect(framesToTimecode(1800, FPS_2997, true)).toBe('00:01:00;02');
    expect(framesToTimecode(3597, FPS_2997, true)).toBe('00:01:59;29');
    expect(framesToTimecode(3598, FPS_2997, true)).toBe('00:02:00;02');
  });

  it('lässt die zehnte Minute ungekürzt', () => {
    expect(framesToTimecode(17982, FPS_2997, true)).toBe('00:10:00;00');
    expect(framesToTimecode(107892, FPS_2997, true)).toBe('01:00:00;00');
  });

  it('kürzt bei 59,94 um vier Frames pro Minute', () => {
    expect(framesToTimecode(3600, FPS_5994, true)).toBe('00:01:00;04');
    expect(framesToTimecode(35964, FPS_5994, true)).toBe('00:10:00;00');
  });

  it('ignoriert das Drop-Frame-Flag bei Raten ohne Drop-Frame', () => {
    expect(framesToTimecode(1500, FPS_25, true)).toBe('00:01:00:00');
  });

  it('bleibt über eine Stunde an der Wanduhr, Non-Drop läuft weg', () => {
    const drop = framesToSeconds(timecodeToFrames('01:00:00;00', FPS_2997, true), FPS_2997);
    const nonDrop = framesToSeconds(timecodeToFrames('01:00:00:00', FPS_2997, false), FPS_2997);
    expect(Math.abs(drop - 3600)).toBeLessThan(0.01); // ~4 ms daneben
    expect(Math.abs(nonDrop - 3600)).toBeGreaterThan(3); // ~3,6 s daneben
  });
});

describe('timecodeToFrames', () => {
  it('ist die Umkehrung von framesToTimecode (Non-Drop)', () => {
    for (const frame of [0, 1, 24, 25, 1500, 90000, 123456]) {
      expect(timecodeToFrames(framesToTimecode(frame, FPS_25), FPS_25)).toBe(frame);
    }
  });

  it('ist die Umkehrung von framesToTimecode (Drop-Frame)', () => {
    for (const frame of [0, 1799, 1800, 3598, 17982, 107892, 250000]) {
      const tc = framesToTimecode(frame, FPS_2997, true);
      expect(timecodeToFrames(tc, FPS_2997, true)).toBe(frame);
    }
  });

  it('erkennt Drop-Frame am Semikolon', () => {
    expect(timecodeToFrames('00:01:00;02', FPS_2997)).toBe(1800);
    expect(timecodeToFrames('00:01:00:02', FPS_2997)).toBe(1802);
  });

  it('versteht die Kurzform ohne Stunden', () => {
    expect(timecodeToFrames('01:00:00', FPS_25)).toBe(1500);
  });

  it('lehnt kaputte Eingaben ab', () => {
    expect(() => timecodeToFrames('abc', FPS_25)).toThrow(SyntaxError);
    expect(() => timecodeToFrames('00:00:00:25', FPS_25)).toThrow(RangeError);
    expect(() => timecodeToFrames('00:70:00:00', FPS_25)).toThrow(RangeError);
  });
});

describe('Sekunden ↔ Frames', () => {
  it('bildet exakte Frame-Grenzen ohne Rundungsfehler ab', () => {
    for (const frame of [0, 1, 999, 5000]) {
      expect(secondsToFrames(framesToSeconds(frame, FPS_2997), FPS_2997)).toBe(frame);
      expect(secondsToFrames(framesToSeconds(frame, FPS_25), FPS_25)).toBe(frame);
    }
  });

  it('ordnet einen Zeitpunkt mitten im Frame dem laufenden Frame zu', () => {
    const mitte = framesToSeconds(10, FPS_25) + 0.02;
    expect(secondsToFrames(mitte, FPS_25)).toBe(10);
  });

  it('springt in die Frame-Mitte, damit der Browser sicher landet', () => {
    const t = frameToSeekTime(10, FPS_25);
    expect(t).toBeGreaterThan(framesToSeconds(10, FPS_25));
    expect(t).toBeLessThan(framesToSeconds(11, FPS_25));
    expect(secondsToFrames(t, FPS_25)).toBe(10);
  });

  it('klemmt negative Werte auf Frame 0', () => {
    expect(secondsToFrames(-5, FPS_25)).toBe(0);
    expect(frameToSeekTime(-3, FPS_25)).toBeCloseTo(0.02, 6);
  });
});

describe('durationToFrameCount / formatDuration', () => {
  it('rechnet Laufzeit in Frames um', () => {
    expect(durationToFrameCount(10, FPS_25)).toBe(250);
    expect(durationToFrameCount(0, FPS_25)).toBe(0);
    expect(durationToFrameCount(1 / 30, FPS_2997)).toBe(1);
  });

  it('formatiert Laufzeiten lesbar', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });
});

describe('Anzeige-Timecode mit Start-Timecode der Kamera', () => {
  const context = { fps: FPS_25, dropFrame: false, startFrames: timecodeToFrames('10:00:00:00', FPS_25) };

  it('addiert den Start-Timecode des Originals', () => {
    expect(frameToDisplayTimecode(0, context)).toBe('10:00:00:00');
    expect(frameToDisplayTimecode(25, context)).toBe('10:00:01:00');
  });

  it('rechnet vom angezeigten Timecode zurück auf den Frame im Video', () => {
    expect(displayTimecodeToFrame('10:00:01:00', context)).toBe(25);
    expect(displayTimecodeToFrame('10:00:00:00', context)).toBe(0);
  });
});
