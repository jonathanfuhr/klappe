/**
 * `Range`-Header nach RFC 7233, so viel davon wie ein Video-Player braucht:
 * ein einzelner Byte-Bereich. Ohne das springt der Player im Browser nicht –
 * Chrome und Safari verlangen für `<video>` eine 206-Antwort.
 */

export type RangeResult =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number; length: number }
  | { kind: 'unsatisfiable' };

export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return { kind: 'full' };

  const match = header.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return { kind: 'full' };

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return { kind: 'full' };
  if (size <= 0) return { kind: 'unsatisfiable' };

  let start: number;
  let end: number;

  if (rawStart === '') {
    // Suffix-Form `bytes=-500`: die letzten n Byte.
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { kind: 'unsatisfiable' };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    if (!Number.isSafeInteger(start) || start >= size) return { kind: 'unsatisfiable' };
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
    if (!Number.isSafeInteger(end)) return { kind: 'unsatisfiable' };
    end = Math.min(end, size - 1);
    if (end < start) return { kind: 'unsatisfiable' };
  }

  return { kind: 'partial', start, end, length: end - start + 1 };
}

/** MIME-Typ anhand der Endung – reicht für die vier Dateiarten der Pipeline. */
export function contentTypeFor(filename: string, fallback = 'application/octet-stream'): string {
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    mxf: 'application/mxf',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  };
  return map[extension] ?? fallback;
}
