/**
 * Kurzlebige Medien-Links (Phase 13).
 *
 * Wozu, wenn die Sitzung im Keks längst reicht? Für alles, wo kein Keks
 * mitgeht: eine Datei in VLC öffnen, eine Adresse in ein anderes Werkzeug
 * kopieren, den Player von einer anderen Herkunft aus einbinden.
 *
 * Wichtig: Der Token **ersetzt** die Rechteprüfung nicht. Er sagt nur „diese
 * Person hat vor wenigen Minuten diesen Link angefordert“ – ob sie die Datei
 * dann noch sehen darf, entscheidet nach wie vor der `AccessService`. Ein
 * entzogener Zugang wirkt damit auch auf einen bereits vergebenen Link.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Welche Datei der Token freischaltet. */
export const MEDIA_KINDS = ['proxy', 'original', 'poster', 'sprite', 'hls'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export interface MediaTokenPayload {
  versionId: string;
  kind: MediaKind;
  userId: string;
  /** Ablauf in Sekunden seit 1970. */
  expiresAt: number;
}

/** Voreinstellung: lang genug für einen Download, kurz genug zum Verfallen. */
export const DEFAULT_MEDIA_TOKEN_TTL_SECONDS = 6 * 60 * 60;

function signature(payload: string, secret: string): string {
  return createHmac('sha256', `klappe:media:${secret}`).update(payload).digest('base64url');
}

/** Format: `<version>.<art>.<benutzer>.<ablauf>.<signatur>` */
export function createMediaToken(
  input: Omit<MediaTokenPayload, 'expiresAt'> & { ttlSeconds?: number },
  secret: string,
  now: number = Date.now(),
): string {
  const expiresAt =
    Math.floor(now / 1000) + (input.ttlSeconds ?? DEFAULT_MEDIA_TOKEN_TTL_SECONDS);
  const body = `${input.versionId}.${input.kind}.${input.userId}.${expiresAt}`;
  return `${body}.${signature(body, secret)}`;
}

/**
 * Prüft Signatur und Ablauf. `null` heißt: nicht verwendbar – der Aufrufer
 * fällt dann auf die Sitzung zurück, statt einen Fehler zu werfen.
 */
export function readMediaToken(
  token: string | undefined | null,
  secret: string,
  now: number = Date.now(),
): MediaTokenPayload | null {
  if (!token) return null;

  const teile = token.split('.');
  if (teile.length !== 5) return null;

  const [versionId, kind, userId, expiresRaw, provided] = teile;
  if (!MEDIA_KINDS.includes(kind as MediaKind)) return null;

  const expiresAt = Number.parseInt(expiresRaw, 10);
  if (!Number.isFinite(expiresAt)) return null;

  const erwartet = signature(`${versionId}.${kind}.${userId}.${expiresRaw}`, secret);
  // Zeitkonstanter Vergleich – ein Unterschied in der Laufzeit verriete sonst
  // Stück für Stück die richtige Signatur.
  const links = Buffer.from(erwartet);
  const rechts = Buffer.from(provided);
  if (links.length !== rechts.length || !timingSafeEqual(links, rechts)) return null;

  if (expiresAt * 1000 <= now) return null;

  return { versionId, kind: kind as MediaKind, userId, expiresAt };
}
