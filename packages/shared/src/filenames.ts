/**
 * Dateinamen für Downloads.
 *
 * Schema: `JJMMTT_Kunde_Projekt_Video_v2_1080p25.mov`
 *
 * Das Datum stammt vom Upload und lässt sich beim Hochladen ändern – es ist
 * das Datum, unter dem die Fassung in der Ablage geführt wird, nicht der
 * Zeitpunkt des Klicks. Fehlende Teile (etwa ein Projekt ohne Kunden) fallen
 * ersatzlos weg, statt Lücken wie `__` zu hinterlassen.
 */

import { versionForFilename } from './versions';

export interface DownloadNameInput {
  /** Datum der Fassung im Format `JJMMTT`. */
  date: string | null;
  customer: string | null;
  projectName: string;
  videoName: string;
  versionNumber: number;
  /** `2160p25`, `1080p50` – siehe `resolutionLabel` in der API. */
  resolution: string | null;
  /** Endung der Originaldatei, ohne Punkt. */
  extension: string | null;
}

/**
 * Macht aus einem Namensteil ein dateinamentaugliches Stück: Der Unterstrich
 * bleibt dem Trenner vorbehalten, Leerzeichen werden zu Bindestrichen.
 */
export function sanitizeNamePart(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60);
}

/** `JJMMTT` aus einem Datum (Ortszeit, denn so denkt die Produktion). */
export function formatFileDate(date: Date): string {
  const year = String(date.getFullYear() % 100).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/** `2026-07-28` → `260728`; gibt `null` bei unbrauchbarer Eingabe zurück. */
export function fileDateFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[1].slice(2)}${match[2]}${match[3]}`;
}

export function buildDownloadFilename(input: DownloadNameInput): string {
  const parts = [
    input.date && /^\d{6}$/.test(input.date) ? input.date : null,
    input.customer ? sanitizeNamePart(input.customer) : null,
    sanitizeNamePart(input.projectName),
    sanitizeNamePart(input.videoName),
    // Nachkommastellen bleiben erhalten (v2.5 → `v2-5`); unbrauchbare Werte
    // fallen auf v1 zurück, damit nie `v0` oder `vNaN` im Dateinamen steht.
    versionForFilename(
      Number.isFinite(input.versionNumber) && input.versionNumber > 0 ? input.versionNumber : 1,
    ),
    input.resolution ? sanitizeNamePart(input.resolution) : null,
  ].filter((part): part is string => Boolean(part));

  const base = parts.join('_') || 'klappe-download';
  const extension = input.extension?.replace(/^\.+/, '').replace(/[^a-zA-Z0-9]/g, '') ?? '';
  return extension ? `${base}.${extension.toLowerCase()}` : base;
}

/** Endung aus einem Dateinamen, ohne Punkt. `null`, wenn keine da ist. */
export function extensionOf(filename: string): string | null {
  const index = filename.lastIndexOf('.');
  if (index <= 0 || index === filename.length - 1) return null;
  const extension = filename.slice(index + 1);
  return /^[a-zA-Z0-9]{1,8}$/.test(extension) ? extension.toLowerCase() : null;
}
