/**
 * Reine Protokoll-Bausteine für den resumable Upload nach tus 1.0.0
 * (Core + Creation + Termination). Bewusst ohne Framework-Bezug, damit die
 * Regeln einzeln testbar sind.
 *
 * Warum tus und kein eigenes Format: Große Kameradateien laufen über WLAN
 * und VPN, Verbindungen brechen ab. tus ist dafür der etablierte Standard,
 * Uppy und andere Clients sprechen ihn ohne Anpassung.
 */

export const TUS_VERSION = '1.0.0';
export const TUS_SUPPORTED_VERSIONS = '1.0.0';
export const TUS_EXTENSIONS = 'creation,termination';
export const TUS_CONTENT_TYPE = 'application/offset+octet-stream';

/** Schlüssel-Wert-Paare aus dem `Upload-Metadata`-Header (Werte sind Base64). */
export function parseUploadMetadata(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};

  for (const pair of header.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex === -1) {
      result[trimmed] = '';
      continue;
    }
    const key = trimmed.slice(0, spaceIndex);
    const rawValue = trimmed.slice(spaceIndex + 1).trim();
    if (!key) continue;
    try {
      result[key] = Buffer.from(rawValue, 'base64').toString('utf8');
    } catch {
      result[key] = '';
    }
  }
  return result;
}

export function encodeUploadMetadata(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key} ${Buffer.from(value, 'utf8').toString('base64')}`)
    .join(',');
}

/** `Upload-Length`/`Upload-Offset` einlesen; `null` bei fehlend oder ungültig. */
export function parseNonNegativeInteger(value: string | string[] | undefined): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export type OffsetCheck =
  | { ok: true; remaining: number }
  | { ok: false; reason: 'offset-mismatch' | 'already-complete' };

/**
 * Prüft, ob ein Client mit seinem Offset weiterschreiben darf.
 * Der Server-Offset ist die Wahrheit: Passt der Client-Offset nicht, bekommt
 * er 409 und holt sich per HEAD den echten Stand.
 */
export function checkOffset(
  clientOffset: number,
  serverOffset: number,
  totalSize: number,
): OffsetCheck {
  if (serverOffset >= totalSize) return { ok: false, reason: 'already-complete' };
  if (clientOffset !== serverOffset) return { ok: false, reason: 'offset-mismatch' };
  return { ok: true, remaining: totalSize - serverOffset };
}

/** Dateiname aus den tus-Metadaten; `filename` ist der übliche Schlüssel. */
export function filenameFromMetadata(metadata: Record<string, string>): string | null {
  const candidate = metadata.filename ?? metadata.name ?? metadata.fileName;
  const trimmed = candidate?.trim();
  return trimmed ? trimmed : null;
}
