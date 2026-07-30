import { describe, expect, it } from 'vitest';
import { loadConfig } from './configuration';

/**
 * Die Grundausstattung, ohne die `loadConfig` im Betrieb aussteigt.
 */
function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    JWT_SECRET: 'secret-secret-secret-secret-0123',
    DATABASE_URL: 'postgres://klappe:klappe@postgres:5432/klappe',
    ...extra,
  };
}

describe('Sitzungs-Cookie', () => {
  // Der Fall, der das Testen über die NAS-Adresse unmöglich gemacht hat: Das
  // Cookie trug `Secure`, der Browser warf es weg, die Anmeldung blieb ohne
  // Fehlermeldung stehen.
  it('bleibt ohne HTTPS unmarkiert, damit der Browser es annimmt', () => {
    const config = loadConfig(env({ PUBLIC_URL: 'http://192.168.1.50:3000' }));
    expect(config.jwt.cookieSecure).toBe(false);
  });

  it('ist hinter HTTPS automatisch geschützt', () => {
    const config = loadConfig(env({ PUBLIC_URL: 'https://klappe.example.org' }));
    expect(config.jwt.cookieSecure).toBe(true);
  });

  it('richtet sich nach der Adresse, nicht nach NODE_ENV', () => {
    const produktivOhneTls = loadConfig(env({ PUBLIC_URL: 'http://nas.local:3000' }));
    expect(produktivOhneTls.jwt.cookieSecure).toBe(false);
  });

  it('lässt sich weiterhin von Hand setzen', () => {
    const erzwungen = loadConfig(
      env({ PUBLIC_URL: 'http://nas.local:3000', SESSION_COOKIE_SECURE: '1' }),
    );
    expect(erzwungen.jwt.cookieSecure).toBe(true);

    const abgeschaltet = loadConfig(
      env({ PUBLIC_URL: 'https://klappe.example.org', SESSION_COOKIE_SECURE: '0' }),
    );
    expect(abgeschaltet.jwt.cookieSecure).toBe(false);
  });

  // Docker Compose reicht nicht gesetzte Werte als leere Zeichenkette durch.
  it('behandelt eine leere Angabe wie „nicht gesetzt“', () => {
    const config = loadConfig(env({ PUBLIC_URL: 'https://klappe.example.org', SESSION_COOKIE_SECURE: '' }));
    expect(config.jwt.cookieSecure).toBe(true);
  });
});

describe('Video-Encoder', () => {
  it('ist ohne Angabe die Software-Kodierung', () => {
    expect(loadConfig(env()).transcode.videoEncoder).toBe('libx264');
  });

  it('übernimmt VideoToolbox für den nativen Mac-Worker', () => {
    const config = loadConfig(env({ VIDEO_ENCODER: 'h264_videotoolbox' }));
    expect(config.transcode.videoEncoder).toBe('h264_videotoolbox');
  });

  // Docker Compose reicht nicht gesetzte Werte als leere Zeichenkette durch.
  it('behandelt eine leere Angabe wie „nicht gesetzt“', () => {
    expect(loadConfig(env({ VIDEO_ENCODER: '' })).transcode.videoEncoder).toBe('libx264');
  });

  it('weist Tippfehler beim Start ab, statt still in Software zu rechnen', () => {
    expect(() => loadConfig(env({ VIDEO_ENCODER: 'videotoolbox' }))).toThrow(/VIDEO_ENCODER/);
  });
});
