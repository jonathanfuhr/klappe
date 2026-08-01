/**
 * Wer bekommt eine Benachrichtigung? Reine Auswahl-Logik, damit sich die
 * Regeln prüfen lassen, ohne Datenbank und Mailserver anzuwerfen.
 */

export interface NotificationCandidate {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  notificationsEnabled: boolean;
  /**
   * Eigene Sprachwahl, wie sie in der Datenbank steht; leer heißt: Vorgabe des
   * Workspace (Phase 26). Jede Mail geht in der Sprache ihres Empfängers
   * hinaus, auch wenn dieselbe Sammlung an mehrere mit verschiedenen
   * Einstellungen geht. Geprüft wird der Wert erst beim Versand.
   */
  locale?: string | null;
}

export interface CommentRecipient extends NotificationCandidate {
  /** Wurde die Person im Kommentar namentlich erwähnt? */
  mentioned: boolean;
}

export interface SelectCommentRecipientsInput {
  authorId: string;
  /** Namentlich erwähnte Personen. */
  mentioned: NotificationCandidate[];
  /**
   * Wer den Film in der Spalte „Benachrichtigungen“ eingetragen hat – über
   * das Projekt oder über dieses Video (Phase 18).
   */
  subscribers?: NotificationCandidate[];
  /**
   * Am Gespräch Beteiligte. Seit Phase 18 sind das die **Gäste**, die zu
   * dieser Fassung schon kommentiert haben: Sie können sich nirgends
   * eintragen, sollen aber die Antwort auf ihre eigene Anmerkung mitbekommen.
   * Fürs Team entscheidet die Eintragung, nicht der Zufall.
   */
  participants: NotificationCandidate[];
}

/**
 * Der Verfasser bekommt nie eine Mail über den eigenen Kommentar. Gesperrte
 * Konten und abbestellte Benachrichtigungen fallen raus – auch bei einer
 * Erwähnung, denn „abbestellt“ heißt abbestellt.
 *
 * Wer mehrfach in Frage kommt, bekommt genau eine Mail; ist eine Erwähnung
 * dabei, gilt die.
 */
export function selectCommentRecipients(input: SelectCommentRecipientsInput): CommentRecipient[] {
  const byId = new Map<string, CommentRecipient>();

  for (const candidate of input.participants) {
    byId.set(candidate.id, { ...candidate, mentioned: false });
  }
  for (const candidate of input.subscribers ?? []) {
    byId.set(candidate.id, { ...candidate, mentioned: false });
  }
  // Zuletzt, damit eine Erwähnung die Einstufung überschreibt.
  for (const candidate of input.mentioned) {
    byId.set(candidate.id, { ...candidate, mentioned: true });
  }

  byId.delete(input.authorId);

  return [...byId.values()].filter(
    (candidate) => candidate.isActive && candidate.notificationsEnabled,
  );
}

/** Für Kunden-Uploads: das Team wird informiert, der Hochladende nicht. */
export function selectTeamRecipients(
  team: NotificationCandidate[],
  uploaderId: string | null,
): NotificationCandidate[] {
  return team.filter(
    (candidate) =>
      candidate.id !== uploaderId && candidate.isActive && candidate.notificationsEnabled,
  );
}

/** Dateigröße für die Mail, ohne Abhängigkeit zur Oberfläche. */
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
