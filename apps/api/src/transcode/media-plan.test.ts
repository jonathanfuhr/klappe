import { describe, expect, it } from 'vitest';
import { planPosterTime, planProxyScale, planSprite } from './media-plan';

describe('planProxyScale', () => {
  it('skaliert UHD auf 1080p', () => {
    expect(planProxyScale(3840, 2160, 1080)).toEqual({ width: 1920, height: 1080, scaled: true });
  });

  it('bläst kleinere Quellen nicht auf', () => {
    expect(planProxyScale(1280, 720, 1080)).toEqual({ width: 1280, height: 720, scaled: false });
  });

  it('liefert immer gerade Kantenlängen', () => {
    const scale = planProxyScale(1919, 1079, 1080);
    expect(scale.width % 2).toBe(0);
    expect(scale.height % 2).toBe(0);
  });

  it('behält das Seitenverhältnis bei ungewöhnlichen Formaten', () => {
    const scale = planProxyScale(2160, 3840, 1080); // Hochformat
    expect(scale).toEqual({ width: 608, height: 1080, scaled: true });
  });

  it('lehnt unsinnige Auflösungen ab', () => {
    expect(() => planProxyScale(0, 1080, 1080)).toThrow(RangeError);
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
    expect(planSprite({ ...base, sourceWidth: 1920, sourceHeight: 800, durationSeconds: 10 })?.tileHeight).toBe(66);
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
