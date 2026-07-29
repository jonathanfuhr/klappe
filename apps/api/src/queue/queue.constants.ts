export const TRANSCODE_QUEUE = 'transcode';
export const TRANSCODE_JOB = 'transcode-version';

/**
 * Zwei Wege in dieselbe Pipeline (Phase 18): Entweder gehört die Datei schon
 * zu einer Fassung, oder sie liegt noch im Zwischenspeicher und wartet
 * darauf, dass jemand Projekt und Video einträgt. Verarbeitet wird sie in
 * beiden Fällen sofort.
 *
 * Seit Phase 19 kommen zwei Nacharbeiten dazu, auf die niemand wartet: die
 * HLS-Stufenleiter und eine Download-Fassung aus einem Format-Preset.
 */
export type TranscodeJobData =
  | { versionId: string }
  | { uploadId: string }
  | { hlsVersionId: string }
  | { renditionId: string };

/**
 * Vorrang in der Warteschlange (Phase 19).
 *
 * BullMQ liest `0` als „keine Priorität" und arbeitet solche Aufträge **vor**
 * allen priorisierten ab. Genau das ist hier gewollt: Die Abspielfassung
 * bekommt deshalb bewusst keine Priorität mitgegeben und drängelt sich damit
 * immer vor. Ein Download, auf den gerade jemand schaut, geht vor der
 * Vorratsarbeit – und die HLS-Leiter wie die Vorab-Erzeugung ganz hinten.
 */
export const TRANSCODE_PRIORITY = {
  /** Ein angefordertes Format – der Kunde sieht den Fortschrittsbalken. */
  angefordert: 1,
  /** Vorab-Erzeugung und HLS-Leiter. */
  vorrat: 10,
} as const;

export const MAIL_QUEUE = 'mail';
export const MAIL_JOB = 'send-notification';

/**
 * Benachrichtigungen laufen über die Warteschlange: Der Empfängerkreis wird
 * erst im Worker aufgelöst, damit ein langsamer Mailserver niemanden beim
 * Kommentieren aufhält. Anmeldecodes und die Testmail gehen dagegen direkt
 * raus – dort ist die Rückmeldung an den Benutzer wichtiger.
 *
 * `digest` ist der zweite Schritt beim Bündeln (Phase 18): `comment` legt die
 * wartenden Hinweise an, `digest` kommt nach der Ruhezeit vorbei und macht
 * daraus eine Mail.
 */
export type MailJobData =
  | { kind: 'comment'; commentId: string }
  | { kind: 'digest'; userId: string; videoId: string }
  | { kind: 'project-file'; projectFileId: string };
