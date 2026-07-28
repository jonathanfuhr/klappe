export const TRANSCODE_QUEUE = 'transcode';
export const TRANSCODE_JOB = 'transcode-version';

export interface TranscodeJobData {
  versionId: string;
}

export const MAIL_QUEUE = 'mail';
export const MAIL_JOB = 'send-notification';

/**
 * Benachrichtigungen laufen über die Warteschlange: Der Empfängerkreis wird
 * erst im Worker aufgelöst, damit ein langsamer Mailserver niemanden beim
 * Kommentieren aufhält. Anmeldecodes und die Testmail gehen dagegen direkt
 * raus – dort ist die Rückmeldung an den Benutzer wichtiger.
 */
export type MailJobData =
  | { kind: 'comment'; commentId: string }
  | { kind: 'project-file'; projectFileId: string };
