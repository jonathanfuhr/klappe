/**
 * Konfiguration ausschließlich aus Umgebungsvariablen – der Container bringt
 * keine eigene Config-Datei mit. Fehlt etwas Sicherheitsrelevantes, startet
 * der Prozess nicht, statt mit einem Standardwert weiterzulaufen.
 */
import { randomBytes } from 'node:crypto';

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  isProduction: boolean;
  port: number;
  publicUrl: string;
  databaseUrl: string;
  redisUrl: string;
  jwt: {
    secret: string;
    /** Gültigkeit des Session-Cookies in Sekunden. */
    ttlSeconds: number;
    cookieName: string;
    cookieSecure: boolean;
  };
  storage: {
    /** Wurzelverzeichnis des Volumes für Originale, Proxys und Thumbnails. */
    root: string;
  };
  uploads: {
    maxBytes: number;
    /** Nach dieser Zeit ohne Fortschritt wird eine Upload-Sitzung aufgeräumt. */
    ttlSeconds: number;
  };
  bootstrapAdmin: {
    email: string | null;
    password: string | null;
    name: string;
  };
  oidc: {
    /**
     * Basis der Entra-Adressen. Weltweit `login.microsoftonline.com`; für
     * die abgeschotteten Clouds (US Government, China) eine andere.
     */
    authority: string;
  };
  transcode: {
    ffmpegPath: string;
    ffprobePath: string;
    /** Zielgröße der **kurzen** Kante – passt für Quer-, Hoch- und Quadratformat. */
    proxyShortEdge: number;
    /** Ab dieser Bitrate wird auch passendes Material neu kodiert. */
    playbackMaxBitrateBps: number;
    proxyVideoBitrate: string;
    proxyMaxrate: string;
    proxyBufsize: string;
    proxyAudioBitrate: string;
    proxyPreset: string;
    posterHeight: number;
    spriteTileWidth: number;
    spriteColumns: number;
    spriteMaxTiles: number;
    concurrency: number;
    /**
     * Zusätzlich zur progressiven Abspielfassung eine HLS-Stufenleiter
     * erzeugen. Kostet einen weiteren Durchlauf und ist deshalb aus.
     */
    hlsEnabled: boolean;
    hlsSegmentSeconds: number;
  };
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(
      `Umgebungsvariable ${key} fehlt. Siehe .env.example für die vollständige Liste.`,
    );
  }
  return value;
}

function readInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Umgebungsvariable ${key} ist keine Zahl: "${raw}"`);
  }
  return parsed;
}

function readBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development';
  const isProduction = nodeEnv === 'production';

  // Im Betrieb ist ein gesetztes Secret Pflicht: ein zufälliges Secret pro
  // Start würde bei jedem Neustart alle Sitzungen ungültig machen und bei
  // mehreren Instanzen gar nicht funktionieren.
  const jwtSecret = isProduction
    ? requireEnv(env, 'JWT_SECRET')
    : (env.JWT_SECRET?.trim() || randomBytes(32).toString('hex'));

  return {
    nodeEnv,
    isProduction,
    port: readInt(env, 'PORT', 3001),
    publicUrl: env.PUBLIC_URL?.trim() || 'http://localhost:3000',
    databaseUrl: isProduction
      ? requireEnv(env, 'DATABASE_URL')
      : (env.DATABASE_URL?.trim() || 'postgres://klappe:klappe@localhost:5432/klappe'),
    redisUrl: env.REDIS_URL?.trim() || 'redis://localhost:6379',
    jwt: {
      secret: jwtSecret,
      ttlSeconds: readInt(env, 'SESSION_TTL_SECONDS', 60 * 60 * 24 * 7),
      cookieName: env.SESSION_COOKIE_NAME?.trim() || 'klappe_session',
      cookieSecure: readBool(env, 'SESSION_COOKIE_SECURE', isProduction),
    },
    storage: {
      root: env.STORAGE_DIR?.trim() || '/data',
    },
    uploads: {
      maxBytes: readInt(env, 'UPLOAD_MAX_BYTES', 200 * 1024 * 1024 * 1024),
      ttlSeconds: readInt(env, 'UPLOAD_TTL_SECONDS', 60 * 60 * 24 * 2),
    },
    bootstrapAdmin: {
      email: env.ADMIN_EMAIL?.trim().toLowerCase() || null,
      password: env.ADMIN_PASSWORD ?? null,
      name: env.ADMIN_NAME?.trim() || 'Administrator',
    },
    oidc: {
      authority:
        env.OIDC_AUTHORITY?.trim().replace(/\/+$/, '') || 'https://login.microsoftonline.com',
    },
    transcode: {
      ffmpegPath: env.FFMPEG_PATH?.trim() || 'ffmpeg',
      ffprobePath: env.FFPROBE_PATH?.trim() || 'ffprobe',
      // PROXY_HEIGHT bleibt als alter Name gültig, damit bestehende
      // .env-Dateien weiterlaufen.
      proxyShortEdge: readInt(env, 'PROXY_SHORT_EDGE', readInt(env, 'PROXY_HEIGHT', 1080)),
      playbackMaxBitrateBps: readInt(env, 'PLAYBACK_MAX_BITRATE_BPS', 20_000_000),
      proxyVideoBitrate: env.PROXY_VIDEO_BITRATE?.trim() || '10M',
      proxyMaxrate: env.PROXY_MAXRATE?.trim() || '12M',
      proxyBufsize: env.PROXY_BUFSIZE?.trim() || '24M',
      proxyAudioBitrate: env.PROXY_AUDIO_BITRATE?.trim() || '192k',
      proxyPreset: env.PROXY_PRESET?.trim() || 'veryfast',
      posterHeight: readInt(env, 'POSTER_HEIGHT', 720),
      spriteTileWidth: readInt(env, 'SPRITE_TILE_WIDTH', 160),
      spriteColumns: readInt(env, 'SPRITE_COLUMNS', 10),
      spriteMaxTiles: readInt(env, 'SPRITE_MAX_TILES', 100),
      concurrency: readInt(env, 'WORKER_CONCURRENCY', 1),
      hlsEnabled: readBool(env, 'HLS_ENABLED', false),
      hlsSegmentSeconds: readInt(env, 'HLS_SEGMENT_SECONDS', 4),
    },
  };
}

export const CONFIG = 'KLAPPE_CONFIG';
