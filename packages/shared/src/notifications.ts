/**
 * Welche Benachrichtigungen es gibt (Phase 28).
 *
 * Bis hierher entschied allein der Code, was hinausging; der Admin konnte nur
 * den Versand als Ganzes abschalten – das ist kein Ventil, das ist der
 * Hauptschalter. Dieser Katalog ist die Liste, über die er einzeln entscheidet.
 *
 * **Er steht im geteilten Paket**, weil ihn drei Seiten brauchen: die API zum
 * Prüfen vor dem Versand, die Einstellungsseite zum Anzeigen und die Migration
 * zum Anlegen. Eine neue Mailart ist genau ein Eintrag hier – und der
 * Übersetzer merkt dann selbst an, wo noch etwas fehlt.
 */

/** Wen eine Mail erreichen kann. Gäste sind die Kundenseite. */
export const NOTIFICATION_AUDIENCES = ['TEAM', 'GUEST'] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

export const NOTIFICATION_KINDS = [
  'guest-code',
  'access-granted',
  'comment',
  'mention',
  'project-file',
  'version-ready',
  'version-failed',
  'guest-first-visit',
  'cleanup-warning',
  'backup-failed',
  'device-paired',
  'test',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationKindInfo {
  kind: NotificationKind;
  /**
   * Empfängerkreise, für die es diese Mail überhaupt gibt. Wo ein Kreis nicht
   * vorkommt, steht in der Oberfläche ein Strich – kein toter Schalter, den
   * jemand umlegt und sich wundert, dass nichts passiert.
   */
  audiences: readonly NotificationAudience[];
  /**
   * Nicht abschaltbar. Ohne den Anmeldecode kommt kein Gast mehr herein; ein
   * Schalter, der die Gastanmeldung stilllegt, ist keine Einstellung, sondern
   * eine Falle.
   */
  alwaysOn?: boolean;
  /** Taucht in der Einstellungsliste gar nicht erst auf (von Hand ausgelöst). */
  hidden?: boolean;
}

export const NOTIFICATION_KIND_INFOS: readonly NotificationKindInfo[] = [
  { kind: 'guest-code', audiences: ['GUEST'], alwaysOn: true },
  { kind: 'access-granted', audiences: ['GUEST'] },
  { kind: 'comment', audiences: ['TEAM', 'GUEST'] },
  { kind: 'mention', audiences: ['TEAM', 'GUEST'] },
  { kind: 'project-file', audiences: ['TEAM'] },
  { kind: 'version-ready', audiences: ['TEAM', 'GUEST'] },
  { kind: 'version-failed', audiences: ['TEAM'] },
  { kind: 'guest-first-visit', audiences: ['TEAM'] },
  { kind: 'cleanup-warning', audiences: ['TEAM'] },
  { kind: 'backup-failed', audiences: ['TEAM'] },
  { kind: 'device-paired', audiences: ['TEAM', 'GUEST'] },
  { kind: 'test', audiences: ['TEAM'], alwaysOn: true, hidden: true },
];

const NACH_ART = new Map(NOTIFICATION_KIND_INFOS.map((info) => [info.kind, info]));

export function notificationKindInfo(kind: NotificationKind): NotificationKindInfo {
  const info = NACH_ART.get(kind);
  // Kann nur passieren, wenn jemand eine Art zur Liste oben hinzufügt und den
  // Eintrag vergisst – dann lieber laut als still durchgelassen.
  if (!info) throw new Error(`Unbekannte Benachrichtigungsart: ${kind}`);
  return info;
}

/** Die Arten, die in der Einstellungsseite stehen – in genau dieser Reihenfolge. */
export function visibleNotificationKinds(): NotificationKindInfo[] {
  return NOTIFICATION_KIND_INFOS.filter((info) => !info.hidden);
}

/** Kommt diese Mailart für diesen Empfängerkreis überhaupt vor? */
export function notificationApplies(
  kind: NotificationKind,
  audience: NotificationAudience,
): boolean {
  return notificationKindInfo(kind).audiences.includes(audience);
}

/**
 * Ein Schalter, wie ihn die API liefert und die Oberfläche zurückschreibt.
 * `null` heißt: Für diesen Kreis gibt es die Mail nicht.
 */
export interface NotificationSettingDto {
  kind: NotificationKind;
  team: boolean | null;
  guest: boolean | null;
  alwaysOn: boolean;
}

export interface NotificationSettingsDto {
  kinds: NotificationSettingDto[];
  /**
   * Ruhezeit für Kommentare in Minuten; `0` schickt sofort und einzeln.
   * Zog in Phase 28 aus dem SMTP-Panel hierher.
   */
  digestMinutes: number;
  /**
   * Ruhezeit für Kundenmaterial in Minuten. Getrennt und deutlich höher: Ein
   * Kommentar ist in Sekunden getippt, ein Kameraband lädt eine halbe Stunde.
   */
  projectFileDigestMinutes: number;
  /**
   * Erwähnungen überspringen die Ruhezeit und gehen sofort hinaus. „Sammelmail
   * ja, aber `@mich` sofort."
   */
  mentionImmediate: boolean;
}

export const MAX_PROJECT_FILE_DIGEST_MINUTES = 24 * 60;
export const DEFAULT_PROJECT_FILE_DIGEST_MINUTES = 30;
