/** Anzeigehelfer für die Oberfläche – bewusst auf Deutsch formatiert. */

const dateTimeFormat = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '–' : dateTimeFormat.format(date);
}

/** „vor 5 Minuten“ für frische Einträge, sonst das Datum. */
export function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '–';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'gerade eben';
  if (seconds < 3600) return `vor ${Math.floor(seconds / 60)} Min.`;
  if (seconds < 86400) return `vor ${Math.floor(seconds / 3600)} Std.`;
  if (seconds < 86400 * 7) return `vor ${Math.floor(seconds / 86400)} Tg.`;
  return dateTimeFormat.format(date);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1).replace('.', ',')} ${units[unitIndex]}`;
}

export function formatFrameRate(frameRate: { num: number; den: number } | null): string {
  if (!frameRate) return '–';
  const value = frameRate.num / frameRate.den;
  const rounded = Math.round(value * 100) / 100;
  return `${String(rounded).replace('.', ',')} fps`;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}
