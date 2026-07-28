/** Kleine Helfer, die an mehreren Stellen dieselbe Regel durchsetzen. */

/** E-Mail-Adressen werden immer klein und ohne Rand-Leerzeichen gespeichert. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Mehrfache Leerzeichen und Zeilenumbrüche in Namen zusammenziehen. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/**
 * Dateinamen für die Ablage entschärfen: keine Pfadanteile, keine
 * Steuerzeichen, keine Windows-Sonderzeichen. Der ursprüngliche Name bleibt
 * in der Datenbank erhalten und wird beim Download wieder verwendet – auf der
 * Platte liegt die Datei ohnehin unter einem generierten Schlüssel.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  return cleaned.slice(0, 200) || 'datei';
}

/**
 * Header-Wert für `Content-Disposition`. Nicht-ASCII wird zusätzlich per
 * RFC 5987 als `filename*` mitgegeben, damit Umlaute im Download ankommen.
 */
export function contentDisposition(filename: string, inline = false): string {
  const safe = sanitizeFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(safe);
  const type = inline ? 'inline' : 'attachment';
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
