import { describe, expect, it } from 'vitest';
import { RateLimiter, rateKey } from './rate-limit';

/** Steuerbare Uhr, damit die Tests keine echte Zeit verstreichen lassen. */
function uhr(start = 1_000_000) {
  let jetzt = start;
  return {
    now: () => jetzt,
    vor: (ms: number) => {
      jetzt += ms;
    },
  };
}

const regel = { limit: 3, windowMs: 60_000 };

describe('RateLimiter', () => {
  it('lässt bis zur Grenze durch', () => {
    const limiter = new RateLimiter(uhr().now);
    for (let versuch = 1; versuch <= 3; versuch += 1) {
      expect(limiter.check('a', regel).allowed).toBe(true);
    }
  });

  it('bremst ab dem Versuch über der Grenze', () => {
    const limiter = new RateLimiter(uhr().now);
    for (let versuch = 0; versuch < 3; versuch += 1) limiter.check('a', regel);

    const entscheidung = limiter.check('a', regel);
    expect(entscheidung.allowed).toBe(false);
    expect(entscheidung.remaining).toBe(0);
    expect(entscheidung.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('zählt die verbleibenden Versuche herunter', () => {
    const limiter = new RateLimiter(uhr().now);
    expect(limiter.check('a', regel).remaining).toBe(2);
    expect(limiter.check('a', regel).remaining).toBe(1);
    expect(limiter.check('a', regel).remaining).toBe(0);
  });

  it('hält verschiedene Schlüssel auseinander', () => {
    const limiter = new RateLimiter(uhr().now);
    for (let versuch = 0; versuch < 3; versuch += 1) limiter.check('a', regel);
    expect(limiter.check('b', regel).allowed).toBe(true);
  });

  it('gibt nach Ablauf des Fensters wieder frei', () => {
    const zeit = uhr();
    const limiter = new RateLimiter(zeit.now);
    for (let versuch = 0; versuch < 3; versuch += 1) limiter.check('a', regel);
    expect(limiter.check('a', regel).allowed).toBe(false);

    zeit.vor(60_001);
    expect(limiter.check('a', regel).allowed).toBe(true);
  });

  it('schiebt das Fenster mit, statt es hart umzuklappen', () => {
    const zeit = uhr();
    const limiter = new RateLimiter(zeit.now);

    limiter.check('a', regel);
    zeit.vor(30_000);
    limiter.check('a', regel);
    limiter.check('a', regel);
    expect(limiter.check('a', regel).allowed).toBe(false);

    // Nur der erste Versuch ist aus dem Fenster gefallen – also genau einer frei.
    zeit.vor(30_001);
    expect(limiter.check('a', regel).allowed).toBe(true);
    expect(limiter.check('a', regel).allowed).toBe(false);
  });

  it('lässt abgelehnte Versuche nicht mitzählen', () => {
    const zeit = uhr();
    const limiter = new RateLimiter(zeit.now);
    for (let versuch = 0; versuch < 3; versuch += 1) limiter.check('a', regel);

    // Stures Weiterklopfen darf die Sperre nicht verlängern.
    for (let versuch = 0; versuch < 20; versuch += 1) {
      zeit.vor(1000);
      limiter.check('a', regel);
    }

    // 60 s nach dem *dritten* echten Versuch ist wieder frei.
    zeit.vor(40_001);
    expect(limiter.check('a', regel).allowed).toBe(true);
  });

  it('nennt eine sinnvolle Wartezeit', () => {
    const zeit = uhr();
    const limiter = new RateLimiter(zeit.now);
    for (let versuch = 0; versuch < 3; versuch += 1) limiter.check('a', regel);

    zeit.vor(20_000);
    expect(limiter.check('a', regel).retryAfterSeconds).toBe(40);
  });

  it('setzt einen Schlüssel auf Wunsch zurück', () => {
    const limiter = new RateLimiter(uhr().now);
    for (let versuch = 0; versuch < 3; versuch += 1) limiter.check('a', regel);
    expect(limiter.check('a', regel).allowed).toBe(false);

    limiter.reset('a');
    expect(limiter.check('a', regel).allowed).toBe(true);
  });

  it('räumt alte Schlüssel weg', () => {
    const zeit = uhr();
    const limiter = new RateLimiter(zeit.now);
    limiter.check('a', regel);
    limiter.check('b', regel);
    expect(limiter.size).toBe(2);

    zeit.vor(60_001);
    expect(limiter.sweep(60_000)).toBe(2);
    expect(limiter.size).toBe(0);
  });

  it('behält beim Aufräumen, was noch im Fenster liegt', () => {
    const zeit = uhr();
    const limiter = new RateLimiter(zeit.now);
    limiter.check('alt', regel);
    zeit.vor(59_000);
    limiter.check('neu', regel);

    zeit.vor(2000);
    limiter.sweep(60_000);
    expect(limiter.size).toBe(1);
  });
});

describe('rateKey', () => {
  it('nimmt die Kennung, wenn es eine gibt', () => {
    expect(rateKey('login', '1.2.3.4', 'Anna@THD.de')).toBe('login|anna@thd.de');
  });

  it('fällt sonst auf die Adresse zurück', () => {
    expect(rateKey('login', '1.2.3.4')).toBe('login|ip:1.2.3.4');
    expect(rateKey('login', '1.2.3.4', null)).toBe('login|ip:1.2.3.4');
  });

  it('trennt Routen voneinander', () => {
    expect(rateKey('login', '1.2.3.4')).not.toBe(rateKey('code', '1.2.3.4'));
  });
});
