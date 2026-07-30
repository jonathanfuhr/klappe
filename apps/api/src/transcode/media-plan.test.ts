import { describe, expect, it } from 'vitest';
import {
  type PlaybackCandidate,
  decidePlayback,
  planPosterTime,
  planProxyScale,
  planSprite,
  resolutionLabel,
} from './media-plan';

describe('planProxyScale – Maß ist die kurze Kante', () => {
  it('skaliert UHD-Querformat auf 1080p', () => {
    expect(planProxyScale(3840, 2160, 1080)).toEqual({ width: 1920, height: 1080, scaled: true });
  });

  it('skaliert UHD-Hochformat auf 1080 Breite statt 1080 Höhe', () => {
    // Wäre die Höhe das Maß, käme 608×1080 heraus – unnötig klein.
    expect(planProxyScale(2160, 3840, 1080)).toEqual({ width: 1080, height: 1920, scaled: true });
  });

  it('skaliert quadratische Videos richtig', () => {
    expect(planProxyScale(2160, 2160, 1080)).toEqual({ width: 1080, height: 1080, scaled: true });
  });

  it('lässt ein Quadrat mit 1080 Kantenlänge unangetastet', () => {
    expect(planProxyScale(1080, 1080, 1080)).toEqual({ width: 1080, height: 1080, scaled: false });
  });

  it('bläst kleinere Quellen nicht auf', () => {
    expect(planProxyScale(1280, 720, 1080)).toEqual({ width: 1280, height: 720, scaled: false });
    expect(planProxyScale(720, 1280, 1080)).toEqual({ width: 720, height: 1280, scaled: false });
  });

  it('behält das Seitenverhältnis bei DCI-Breitbild', () => {
    expect(planProxyScale(4096, 2160, 1080)).toEqual({ width: 2048, height: 1080, scaled: true });
  });

  it('liefert immer gerade Kantenlängen', () => {
    const scale = planProxyScale(3841, 2161, 1080);
    expect(scale.width % 2).toBe(0);
    expect(scale.height % 2).toBe(0);
  });

  it('lehnt unsinnige Auflösungen ab', () => {
    expect(() => planProxyScale(0, 1080, 1080)).toThrow(RangeError);
  });
});

describe('decidePlayback', () => {
  const limits = { maxShortEdge: 1080, maxBitrateBps: 20_000_000 };
  const gutesMp4: PlaybackCandidate = {
    videoCodec: 'h264',
    audioCodec: 'aac',
    pixelFormat: 'yuv420p',
    formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    width: 1920,
    height: 1080,
    bitrateBps: 12_000_000,
    fastStart: true,
  };

  it('lässt ein fertiges 1080p-MP4 unangetastet', () => {
    const entscheidung = decidePlayback(gutesMp4, limits);
    expect(entscheidung.mode).toBe('ORIGINAL');
  });

  it('verpackt nur neu, wenn der Index hinten liegt', () => {
    const entscheidung = decidePlayback({ ...gutesMp4, fastStart: false }, limits);
    expect(entscheidung.mode).toBe('REMUX');
    expect(entscheidung.reason).toMatch(/Index/);
  });

  it('nimmt auch Hochformat und stummes Material an', () => {
    expect(decidePlayback({ ...gutesMp4, width: 1080, height: 1920 }, limits).mode).toBe('ORIGINAL');
    expect(decidePlayback({ ...gutesMp4, audioCodec: null }, limits).mode).toBe('ORIGINAL');
  });

  it('kodiert bei zu großer kurzer Kante neu', () => {
    const entscheidung = decidePlayback({ ...gutesMp4, width: 3840, height: 2160 }, limits);
    expect(entscheidung.mode).toBe('TRANSCODE');
    expect(entscheidung.reason).toMatch(/Kurze Kante/);
  });

  it('kodiert bei zu hoher Bitrate neu, auch wenn der Codec passt', () => {
    const entscheidung = decidePlayback({ ...gutesMp4, bitrateBps: 90_000_000 }, limits);
    expect(entscheidung.mode).toBe('TRANSCODE');
    expect(entscheidung.reason).toMatch(/Bitrate/);
  });

  it('kodiert fremde Codecs neu', () => {
    expect(decidePlayback({ ...gutesMp4, videoCodec: 'prores' }, limits).mode).toBe('TRANSCODE');
    expect(decidePlayback({ ...gutesMp4, videoCodec: 'dnxhd' }, limits).mode).toBe('TRANSCODE');
    expect(decidePlayback({ ...gutesMp4, audioCodec: 'pcm_s16le' }, limits).mode).toBe('TRANSCODE');
  });

  it('kodiert 10-Bit- und 4:2:2-Material neu', () => {
    expect(decidePlayback({ ...gutesMp4, pixelFormat: 'yuv422p10le' }, limits).mode).toBe('TRANSCODE');
    expect(decidePlayback({ ...gutesMp4, pixelFormat: 'yuv420p10le' }, limits).mode).toBe('TRANSCODE');
  });

  it('kodiert fremde Container neu', () => {
    expect(decidePlayback({ ...gutesMp4, formatName: 'matroska,webm' }, limits).mode).toBe('TRANSCODE');
    expect(decidePlayback({ ...gutesMp4, formatName: 'mxf' }, limits).mode).toBe('TRANSCODE');
    expect(decidePlayback({ ...gutesMp4, formatName: null }, limits).mode).toBe('TRANSCODE');
  });

  it('kodiert neu, wenn die Auflösung unbekannt ist', () => {
    expect(decidePlayback({ ...gutesMp4, width: null, height: null }, limits).mode).toBe('TRANSCODE');
  });

  it('nennt für jede Entscheidung einen Grund', () => {
    for (const kandidat of [
      gutesMp4,
      { ...gutesMp4, fastStart: false },
      { ...gutesMp4, videoCodec: 'prores' },
    ]) {
      expect(decidePlayback(kandidat, limits).reason.length).toBeGreaterThan(10);
    }
  });
});

describe('resolutionLabel', () => {
  it('bildet die kurze Kante mit Bildrate ab', () => {
    expect(resolutionLabel(3840, 2160, { num: 25, den: 1 })).toBe('2160p25');
    expect(resolutionLabel(1920, 1080, { num: 50, den: 1 })).toBe('1080p50');
  });

  it('nimmt bei Hochformat ebenfalls die kurze Kante', () => {
    expect(resolutionLabel(1080, 1920, { num: 25, den: 1 })).toBe('1080p25');
  });

  it('schreibt NTSC-Raten ohne Komma', () => {
    expect(resolutionLabel(1920, 1080, { num: 30000, den: 1001 })).toBe('1080p2997');
    expect(resolutionLabel(1920, 1080, { num: 24000, den: 1001 })).toBe('1080p2398');
    expect(resolutionLabel(1920, 1080, { num: 60000, den: 1001 })).toBe('1080p5994');
  });

  it('kommt ohne Bildrate und ohne Auflösung klar', () => {
    expect(resolutionLabel(1920, 1080, null)).toBe('1080p');
    expect(resolutionLabel(null, null, { num: 25, den: 1 })).toBeNull();
  });
});

describe('planSprite', () => {
  const base = { sourceWidth: 1920, sourceHeight: 1080, tileWidth: 160, columns: 10, maxTiles: 100 };

  it('nimmt etwa eine Kachel pro zwei Sekunden', () => {
    const plan = planSprite({ ...base, durationSeconds: 60 });
    expect(plan?.tileCount).toBe(30);
    expect(plan?.rows).toBe(3);
    expect(plan?.intervalSeconds).toBeCloseTo(2, 6);
  });

  it('deckelt lange Videos auf maxTiles und vergrößert dafür den Abstand', () => {
    const plan = planSprite({ ...base, durationSeconds: 7200 });
    expect(plan?.tileCount).toBe(100);
    expect(plan?.rows).toBe(10);
    expect(plan?.intervalSeconds).toBe(72);
  });

  it('deckt mit Kachel × Intervall genau die Laufzeit ab', () => {
    const duration = 137.5;
    const plan = planSprite({ ...base, durationSeconds: duration });
    expect((plan?.tileCount ?? 0) * (plan?.intervalSeconds ?? 0)).toBeCloseTo(duration, 6);
  });

  it('erzeugt für sehr kurze Videos wenigstens eine Kachel', () => {
    const plan = planSprite({ ...base, durationSeconds: 0.8 });
    expect(plan?.tileCount).toBe(1);
    expect(plan?.rows).toBe(1);
  });

  it('leitet die Kachelhöhe aus dem Seitenverhältnis ab', () => {
    expect(planSprite({ ...base, durationSeconds: 10 })?.tileHeight).toBe(90);
    expect(planSprite({ ...base, sourceWidth: 1080, sourceHeight: 1920, durationSeconds: 10 })?.tileHeight).toBe(284);
  });

  it('gibt null zurück, wenn Laufzeit oder Auflösung fehlen', () => {
    expect(planSprite({ ...base, durationSeconds: 0 })).toBeNull();
    expect(planSprite({ ...base, durationSeconds: 10, sourceWidth: 0 })).toBeNull();
  });
});

describe('planPosterTime', () => {
  it('greift zehn Prozent hinein, höchstens fünf Sekunden', () => {
    expect(planPosterTime(30)).toBeCloseTo(3, 6);
    expect(planPosterTime(600)).toBe(5);
  });

  it('bleibt bei sehr kurzen Clips im Video', () => {
    expect(planPosterTime(0.05)).toBe(0);
    expect(planPosterTime(null)).toBe(0);
  });
});
