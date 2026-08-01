/**
 * E-Mail-Vorlagen. Reine Funktionen: Daten rein, Betreff/Text/HTML raus –
 * damit lassen sie sich prüfen, ohne einen Mailserver anzuwerfen.
 *
 * Jede Mail geht als Text *und* als HTML raus. Der Textteil ist nicht bloß
 * Beiwerk: Manche Postfächer zeigen ihn, und er hilft gegen die
 * Spam-Einstufung.
 *
 * Seit Phase 26 in der Sprache des **Empfängers**: Jede Vorlage bekommt eine
 * `locale` mit; ohne Angabe bleibt es bei Deutsch. Anders als in der
 * Oberfläche gibt es hier keinen Kontext, aus dem sich die Sprache ableiten
 * ließe – sie muss beim Aufruf feststehen, denn dieselbe Sammelmail geht an
 * mehrere Menschen mit womöglich verschiedenen Einstellungen.
 */
import { type Locale, DEFAULT_LOCALE } from '@klappe/shared';

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Erscheinungsbild des Workspace in der Mail (Phase 10). Ohne Angabe bleibt
 * es beim Standard – eine Mail soll nicht daran scheitern, dass gerade keine
 * Einstellungen geladen werden konnten.
 */
export interface MailBrand {
  title: string;
  accent: string;
  accentContrast: string;
}

export const DEFAULT_MAIL_BRAND: MailBrand = {
  title: 'Klappe',
  accent: '#4c8dff',
  accentContrast: '#04070d',
};

/** Die festen Wendungen der Mails, je Sprache. */
interface MailTexte {
  hallo: (name: string) => string;
  unsubscribe: string;
  unsubscribeLine: (url: string) => string;
  watchLine: (url: string) => string;
  toProjectLine: (url: string) => string;
  goThereLine: (url: string) => string;
  noTimecode: string;
  project: (name: string) => string;
  projectAndVersion: (project: string, version: string) => string;
  watchInPlayer: string;
  toProject: string;
  view: string;
  // Anmeldecode
  codeSubject: (code: string, brand: string) => string;
  codeTitle: string;
  codeIntro: (target: string) => string;
  codeText: (target: string, code: string) => string;
  codeValid: (minutes: number) => string;
  codeIgnore: string;
  // Kommentare
  mentionedSubject: (author: string, video: string) => string;
  replySubject: (author: string, video: string) => string;
  commentSubject: (author: string, video: string) => string;
  mentionedIntro: (author: string, video: string) => string;
  replyIntro: (author: string, video: string) => string;
  commentIntro: (author: string, video: string) => string;
  // Sammelmail
  digestOne: (video: string) => string;
  digestMany: (count: number, video: string) => string;
  digestMentioned: (kern: string) => string;
  digestIntro: (authors: string, count: number, video: string) => string;
  digestEntryMentioned: string;
  joinNames: (names: string[]) => string;
  // Kunden-Upload
  fileSubject: (project: string) => string;
  fileIntro: (uploader: string, project: string) => string;
  fileLine: (filename: string, size: string) => string;
  fileDigestSubject: (count: number, project: string) => string;
  fileDigestIntro: (uploader: string, count: number, project: string) => string;
  fileDigestTotal: (size: string) => string;
  // Neue Fassung (Phase 28)
  versionSubject: (version: string, video: string) => string;
  versionIntro: (version: string, video: string) => string;
  versionInternalNote: string;
  versionReleasedNote: (actor: string) => string;
  versionFailedSubject: (video: string) => string;
  versionFailedIntro: (version: string, video: string) => string;
  versionFailedReason: (reason: string) => string;
  // Weitere Hinweise (Phase 28)
  firstVisitSubject: (guest: string, target: string) => string;
  firstVisitIntro: (guest: string, target: string) => string;
  cleanupSubject: (project: string) => string;
  cleanupIntro: (project: string, days: number) => string;
  cleanupDetail: (count: number) => string;
  backupSubject: string;
  backupIntro: string;
  backupReason: (reason: string) => string;
  deviceSubject: (client: string) => string;
  deviceIntro: (client: string) => string;
  deviceHint: string;
  // Zugang freigeschaltet
  accessSubject: (target: string) => string;
  accessIntro: (actor: string, target: string) => string;
  accessNoNewLink: string;
  // Testmail
  testSubject: (brand: string) => string;
  testTitle: string;
  testIntro: (brand: string) => string;
  testServer: (host: string) => string;
  testFrom: (email: string) => string;
  testSpf: string;
}

const DE: MailTexte = {
  hallo: (name) => `Hallo ${name},`,
  unsubscribe: 'Benachrichtigungen abbestellen',
  unsubscribeLine: (url) => `Keine solchen Mails mehr: ${url}`,
  watchLine: (url) => `Ansehen: ${url}`,
  toProjectLine: (url) => `Zum Projekt: ${url}`,
  goThereLine: (url) => `Direkt hin: ${url}`,
  noTimecode: '[ohne Zeitbezug]',
  project: (name) => `Projekt: ${name}`,
  projectAndVersion: (project, version) => `Projekt: ${project} · Fassung: ${version}`,
  watchInPlayer: 'Im Player ansehen',
  toProject: 'Zum Projekt',
  view: 'Ansehen',
  codeSubject: (code, brand) => `${code} ist dein Anmeldecode für ${brand}`,
  codeTitle: 'Dein Anmeldecode',
  codeIntro: (target) => `Für den Zugang zu „${target}“ brauchst du diesen Code:`,
  codeText: (target, code) => `Dein Anmeldecode für „${target}“ lautet: ${code}`,
  codeValid: (minutes) => `Der Code gilt ${minutes} Minuten.`,
  codeIgnore: 'Wenn du das nicht angefordert hast, kannst du diese Nachricht ignorieren.',
  mentionedSubject: (author, video) => `${author} hat dich erwähnt: ${video}`,
  replySubject: (author, video) => `Neue Antwort von ${author}: ${video}`,
  commentSubject: (author, video) => `Neuer Kommentar von ${author}: ${video}`,
  mentionedIntro: (author, video) => `${author} hat dich in einem Kommentar zu „${video}“ erwähnt.`,
  replyIntro: (author, video) => `${author} hat auf ein Gespräch zu „${video}“ geantwortet.`,
  commentIntro: (author, video) => `${author} hat „${video}“ kommentiert.`,
  digestOne: (video) => `Ein neuer Kommentar zu „${video}“`,
  digestMany: (count, video) => `${count} neue Kommentare zu „${video}“`,
  digestMentioned: (kern) => `Du wurdest erwähnt – ${kern.charAt(0).toLowerCase()}${kern.slice(1)}`,
  digestIntro: (authors, count, video) =>
    `${authors} ${count === 1 ? 'hat' : 'haben'} „${video}“ kommentiert.`,
  digestEntryMentioned: ' · dich erwähnt',
  joinNames: (names) =>
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`,
  fileSubject: (project) => `Neues Material im Projekt ${project}`,
  fileIntro: (uploader, project) => `${uploader} hat Material in „${project}“ hochgeladen.`,
  fileLine: (filename, size) => `Datei: ${filename} (${size})`,
  fileDigestSubject: (count, project) => `${count} neue Dateien im Projekt ${project}`,
  fileDigestIntro: (uploader, count, project) =>
    `${uploader} hat ${count} Dateien in „${project}“ hochgeladen.`,
  fileDigestTotal: (size) => `Zusammen ${size}.`,
  versionSubject: (version, video) => `Neue Fassung ${version}: ${video}`,
  versionIntro: (version, video) => `Für „${video}“ steht ${version} bereit.`,
  versionInternalNote: 'Diese Fassung ist intern – Gäste sehen sie erst nach der Freigabe.',
  versionReleasedNote: (actor) => `${actor} hat sie für Gäste freigegeben.`,
  versionFailedSubject: (video) => `Verarbeitung fehlgeschlagen: ${video}`,
  versionFailedIntro: (version, video) =>
    `${version} von „${video}“ konnte nicht verarbeitet werden.`,
  versionFailedReason: (reason) => `Grund: ${reason}`,
  firstVisitSubject: (guest, target) => `${guest} war zum ersten Mal in ${target}`,
  firstVisitIntro: (guest, target) => `${guest} hat „${target}“ zum ersten Mal geöffnet.`,
  cleanupSubject: (project) => `Alte Fassungen werden bald gelöscht: ${project}`,
  cleanupIntro: (project, days) =>
    days <= 0
      ? `Im archivierten Projekt „${project}“ werden die alten Fassungen jetzt gelöscht.`
      : `Im archivierten Projekt „${project}“ werden die alten Fassungen in ${days} Tag(en) gelöscht.`,
  cleanupDetail: (count) =>
    `Betroffen sind ${count} Fassung(en). Die jeweils neueste bleibt erhalten. Wer etwas davon behalten will, lädt es vorher herunter oder holt das Projekt aus dem Archiv.`,
  backupSubject: 'Die Datenbanksicherung ist fehlgeschlagen',
  backupIntro: 'Die geplante Sicherung der Datenbank konnte nicht erstellt werden.',
  backupReason: (reason) => `Grund: ${reason}`,
  deviceSubject: (client) => `Neues Gerät verbunden: ${client}`,
  deviceIntro: (client) => `„${client}“ nutzt ab jetzt dein Konto über die Schnittstelle.`,
  deviceHint:
    'Warst du das nicht, trenne das Gerät unter „Profil und Sicherheit“ – der Zugang gilt sofort nicht mehr.',
  accessSubject: (target) => `Freigeschaltet: ${target}`,
  accessIntro: (actor, target) => `${actor} hat „${target}“ für dich freigegeben.`,
  accessNoNewLink: 'Du brauchst dafür keinen neuen Link – melde dich an wie gewohnt.',
  testSubject: (brand) => `${brand}: SMTP-Einstellungen funktionieren`,
  testTitle: 'SMTP-Einstellungen funktionieren',
  testIntro: (brand) =>
    `Diese Testnachricht bestätigt, dass ${brand} über deinen Mailserver versenden kann.`,
  testServer: (host) => `Server: ${host}`,
  testFrom: (email) => `Absender: ${email}`,
  testSpf:
    'Damit Codes und Benachrichtigungen nicht im Spam landen, sollte die Absender-Domain SPF und DKIM gesetzt haben.',
};

const EN: MailTexte = {
  hallo: (name) => `Hello ${name},`,
  unsubscribe: 'Unsubscribe from notifications',
  unsubscribeLine: (url) => `No more mail like this: ${url}`,
  watchLine: (url) => `Watch: ${url}`,
  toProjectLine: (url) => `To the project: ${url}`,
  goThereLine: (url) => `Go straight there: ${url}`,
  noTimecode: '[no time reference]',
  project: (name) => `Project: ${name}`,
  projectAndVersion: (project, version) => `Project: ${project} · Version: ${version}`,
  watchInPlayer: 'Watch in the player',
  toProject: 'To the project',
  view: 'View',
  codeSubject: (code, brand) => `${code} is your sign-in code for ${brand}`,
  codeTitle: 'Your sign-in code',
  codeIntro: (target) => `To get access to “${target}” you need this code:`,
  codeText: (target, code) => `Your sign-in code for “${target}” is: ${code}`,
  codeValid: (minutes) => `The code is valid for ${minutes} minutes.`,
  codeIgnore: 'If you did not request this, you can ignore this message.',
  mentionedSubject: (author, video) => `${author} mentioned you: ${video}`,
  replySubject: (author, video) => `New reply from ${author}: ${video}`,
  commentSubject: (author, video) => `New comment from ${author}: ${video}`,
  mentionedIntro: (author, video) => `${author} mentioned you in a comment on “${video}”.`,
  replyIntro: (author, video) => `${author} replied in a thread on “${video}”.`,
  commentIntro: (author, video) => `${author} commented on “${video}”.`,
  digestOne: (video) => `One new comment on “${video}”`,
  digestMany: (count, video) => `${count} new comments on “${video}”`,
  digestMentioned: (kern) => `You were mentioned – ${kern.charAt(0).toLowerCase()}${kern.slice(1)}`,
  digestIntro: (authors, count, video) =>
    `${authors} ${count === 1 ? 'has' : 'have'} commented on “${video}”.`,
  digestEntryMentioned: ' · mentioned you',
  joinNames: (names) =>
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`,
  fileSubject: (project) => `New material in the project ${project}`,
  fileIntro: (uploader, project) => `${uploader} uploaded material to “${project}”.`,
  fileLine: (filename, size) => `File: ${filename} (${size})`,
  fileDigestSubject: (count, project) => `${count} new files in the project ${project}`,
  fileDigestIntro: (uploader, count, project) =>
    `${uploader} uploaded ${count} files to “${project}”.`,
  fileDigestTotal: (size) => `${size} in total.`,
  versionSubject: (version, video) => `New version ${version}: ${video}`,
  versionIntro: (version, video) => `${version} of “${video}” is ready.`,
  versionInternalNote: 'This version is internal – guests will not see it until it is released.',
  versionReleasedNote: (actor) => `${actor} released it for guests.`,
  versionFailedSubject: (video) => `Processing failed: ${video}`,
  versionFailedIntro: (version, video) => `${version} of “${video}” could not be processed.`,
  versionFailedReason: (reason) => `Reason: ${reason}`,
  firstVisitSubject: (guest, target) => `${guest} visited ${target} for the first time`,
  firstVisitIntro: (guest, target) => `${guest} opened “${target}” for the first time.`,
  cleanupSubject: (project) => `Old versions will be deleted soon: ${project}`,
  cleanupIntro: (project, days) =>
    days <= 0
      ? `In the archived project “${project}” the old versions are being deleted now.`
      : `In the archived project “${project}” the old versions will be deleted in ${days} day(s).`,
  cleanupDetail: (count) =>
    `${count} version(s) are affected. The newest one of each video is kept. If you want to keep any of them, download them first or take the project out of the archive.`,
  backupSubject: 'The database backup failed',
  backupIntro: 'The scheduled database backup could not be created.',
  backupReason: (reason) => `Reason: ${reason}`,
  deviceSubject: (client) => `New device connected: ${client}`,
  deviceIntro: (client) => `“${client}” now uses your account through the API.`,
  deviceHint:
    'If that was not you, disconnect the device under “Profile and security” – access stops immediately.',
  accessSubject: (target) => `Now available: ${target}`,
  accessIntro: (actor, target) => `${actor} shared “${target}” with you.`,
  accessNoNewLink: 'You do not need a new link for that – sign in as usual.',
  testSubject: (brand) => `${brand}: SMTP settings work`,
  testTitle: 'SMTP settings work',
  testIntro: (brand) => `This test message confirms that ${brand} can send via your mail server.`,
  testServer: (host) => `Server: ${host}`,
  testFrom: (email) => `Sender: ${email}`,
  testSpf:
    'So that codes and notifications do not end up in spam, the sender domain should have SPF and DKIM set.',
};

function texte(locale: Locale | undefined): MailTexte {
  return locale === 'en' ? EN : DE;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Gemeinsamer Rahmen: schlicht, mit Inline-Stilen (Mailclients mögen kein CSS). */
function layout(input: {
  title: string;
  body: string;
  buttonLabel?: string;
  buttonUrl?: string;
  footerNote?: string;
  unsubscribeUrl?: string;
  brand?: MailBrand;
  locale?: Locale;
}): string {
  const brand = input.brand ?? DEFAULT_MAIL_BRAND;
  const t = texte(input.locale);
  const locale = input.locale ?? DEFAULT_LOCALE;

  const button =
    input.buttonLabel && input.buttonUrl
      ? `<p style="margin:26px 0"><a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;background:${escapeHtml(brand.accent)};color:${escapeHtml(brand.accentContrast)};font-weight:600;text-decoration:none;padding:11px 20px;border-radius:6px">${escapeHtml(input.buttonLabel)}</a></p>`
      : '';

  const footerParts: string[] = [];
  if (input.footerNote) footerParts.push(escapeHtml(input.footerNote));
  if (input.unsubscribeUrl) {
    footerParts.push(
      `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#6b7482">${escapeHtml(t.unsubscribe)}</a>`,
    );
  }

  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#16191f">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:28px">
    <div style="font-weight:650;font-size:17px;margin-bottom:18px">${escapeHtml(brand.title)}</div>
    <h1 style="font-size:19px;margin:0 0 14px">${escapeHtml(input.title)}</h1>
    ${input.body}
    ${button}
  </div>
  ${
    footerParts.length > 0
      ? `<div style="max-width:560px;margin:14px auto 0;font-size:12px;color:#6b7482;text-align:center">${footerParts.join(' · ')}</div>`
      : ''
  }
</body></html>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(text)}</p>`;
}

/** Zitat des Kommentars mit Timecode-Zeile darüber. */
function quote(body: string, timecode: string | null): string {
  const heading = timecode
    ? `<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:#4c8dff;margin-bottom:6px">${escapeHtml(timecode)}</div>`
    : '';
  return `<div style="border-left:3px solid #d5d9e0;padding:2px 0 2px 12px;margin:0 0 16px">${heading}<div style="white-space:pre-wrap;line-height:1.5">${escapeHtml(body)}</div></div>`;
}

// ---------- Gast-Anmeldung ----------

export function renderGuestCodeMail(input: {
  code: string;
  targetName: string;
  minutesValid: number;
  brand?: MailBrand;
  locale?: Locale;
}): RenderedMail {
  const brand = input.brand ?? DEFAULT_MAIL_BRAND;
  const t = texte(input.locale);
  const text = [
    t.codeText(input.targetName, input.code),
    '',
    t.codeValid(input.minutesValid),
    t.codeIgnore,
  ].join('\n');

  return {
    // Der Code steht bewusst im Betreff: Auf dem Handy ist er dann schon in
    // der Vorschau lesbar, ohne die Mail zu öffnen.
    subject: t.codeSubject(input.code, brand.title),
    text,
    html: layout({
      brand,
      locale: input.locale,
      title: t.codeTitle,
      body: [
        paragraph(t.codeIntro(input.targetName)),
        `<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:32px;letter-spacing:8px;font-weight:700;margin:18px 0;padding:14px;background:#f4f5f7;border-radius:8px;text-align:center">${escapeHtml(input.code)}</div>`,
        paragraph(t.codeValid(input.minutesValid)),
        paragraph(t.codeIgnore),
      ].join(''),
    }),
  };
}

// ---------- Kommentare ----------

export interface CommentMailInput {
  recipientName: string;
  authorName: string;
  projectName: string;
  videoName: string;
  versionLabel: string;
  timecode: string | null;
  body: string;
  /** Der Empfänger wurde namentlich erwähnt. */
  mentioned: boolean;
  /** Es ist eine Antwort in einem Gespräch. */
  isReply: boolean;
  url: string;
  unsubscribeUrl: string;
  brand?: MailBrand;
  locale?: Locale;
}

export function renderCommentMail(input: CommentMailInput): RenderedMail {
  const t = texte(input.locale);
  const subject = input.mentioned
    ? t.mentionedSubject(input.authorName, input.videoName)
    : input.isReply
      ? t.replySubject(input.authorName, input.videoName)
      : t.commentSubject(input.authorName, input.videoName);

  const intro = input.mentioned
    ? t.mentionedIntro(input.authorName, input.videoName)
    : input.isReply
      ? t.replyIntro(input.authorName, input.videoName)
      : t.commentIntro(input.authorName, input.videoName);

  const text = [
    t.hallo(input.recipientName),
    '',
    intro,
    t.projectAndVersion(input.projectName, input.versionLabel),
    '',
    input.timecode ? `[${input.timecode}]` : t.noTimecode,
    input.body,
    '',
    t.watchLine(input.url),
    '',
    t.unsubscribeLine(input.unsubscribeUrl),
  ].join('\n');

  return {
    subject,
    text,
    html: layout({
      brand: input.brand,
      locale: input.locale,
      title: intro,
      body: [
        paragraph(t.projectAndVersion(input.projectName, input.versionLabel)),
        quote(input.body, input.timecode),
      ].join(''),
      buttonLabel: t.watchInPlayer,
      buttonUrl: input.url,
      unsubscribeUrl: input.unsubscribeUrl,
    }),
  };
}

// ---------- Sammelmail für Kommentare (Phase 18) ----------

export interface CommentDigestEntry {
  authorName: string;
  versionLabel: string;
  timecode: string | null;
  body: string;
  /** Der Empfänger wurde in genau diesem Kommentar erwähnt. */
  mentioned: boolean;
}

export interface CommentDigestMailInput {
  recipientName: string;
  projectName: string;
  videoName: string;
  /** In der Reihenfolge, in der sie geschrieben wurden. */
  entries: CommentDigestEntry[];
  url: string;
  unsubscribeUrl: string;
  brand?: MailBrand;
  locale?: Locale;
}

/**
 * Ein Block je Kommentar: Wer, zu welcher Fassung, an welcher Stelle. Die
 * Fassung steht dabei, weil eine Sammelmail durchaus Kommentare zu v1 und v2
 * enthalten kann.
 */
function digestEntry(entry: CommentDigestEntry, t: MailTexte): string {
  const kopf = `${entry.authorName} · ${entry.versionLabel}${entry.mentioned ? t.digestEntryMentioned : ''}`;
  return `<div style="margin:0 0 18px"><div style="font-size:13px;color:#6b7482;margin-bottom:5px">${escapeHtml(kopf)}</div>${quote(entry.body, entry.timecode)}</div>`;
}

export function renderCommentDigestMail(input: CommentDigestMailInput): RenderedMail {
  const t = texte(input.locale);
  const anzahl = input.entries.length;
  const erwaehnt = input.entries.some((entry) => entry.mentioned);
  const autoren = t.joinNames([...new Set(input.entries.map((entry) => entry.authorName))]);

  const kern = anzahl === 1 ? t.digestOne(input.videoName) : t.digestMany(anzahl, input.videoName);
  // Eine Erwähnung gehört in den Betreff – sonst geht sie in der Sammelmail
  // unter, und genau die ist der Grund, warum jemand sofort hineinschaut.
  const subject = erwaehnt ? t.digestMentioned(kern) : kern;

  const intro = t.digestIntro(autoren, anzahl, input.videoName);

  const text = [
    t.hallo(input.recipientName),
    '',
    intro,
    t.project(input.projectName),
    '',
    ...input.entries.flatMap((entry) => [
      `${entry.authorName} · ${entry.versionLabel}${entry.mentioned ? t.digestEntryMentioned : ''}`,
      entry.timecode ? `[${entry.timecode}]` : t.noTimecode,
      entry.body,
      '',
    ]),
    t.watchLine(input.url),
    '',
    t.unsubscribeLine(input.unsubscribeUrl),
  ].join('\n');

  return {
    subject,
    text,
    html: layout({
      brand: input.brand,
      locale: input.locale,
      title: intro,
      body: [
        paragraph(t.project(input.projectName)),
        input.entries.map((entry) => digestEntry(entry, t)).join(''),
      ].join(''),
      buttonLabel: t.watchInPlayer,
      buttonUrl: input.url,
      unsubscribeUrl: input.unsubscribeUrl,
    }),
  };
}

// ---------- Kunden-Upload ----------

export function renderProjectFileMail(input: {
  recipientName: string;
  uploaderName: string;
  projectName: string;
  filename: string;
  sizeLabel: string;
  url: string;
  unsubscribeUrl: string;
  brand?: MailBrand;
  locale?: Locale;
}): RenderedMail {
  const t = texte(input.locale);
  const intro = t.fileIntro(input.uploaderName, input.projectName);

  return {
    subject: t.fileSubject(input.projectName),
    text: [
      t.hallo(input.recipientName),
      '',
      intro,
      t.fileLine(input.filename, input.sizeLabel),
      '',
      t.toProjectLine(input.url),
      '',
      t.unsubscribeLine(input.unsubscribeUrl),
    ].join('\n'),
    html: layout({
      brand: input.brand,
      locale: input.locale,
      title: intro,
      body: paragraph(t.fileLine(input.filename, input.sizeLabel)),
      buttonLabel: t.toProject,
      buttonUrl: input.url,
      unsubscribeUrl: input.unsubscribeUrl,
    }),
  };
}

/**
 * Sammelmail für Kundenmaterial (Phase 28).
 *
 * Ein Kunde lädt selten eine Datei – er lädt einen Ordner. Zwanzig Mails über
 * zwanzig Dateien sind zwanzig Mal dieselbe Nachricht. Deshalb nennt diese
 * Mail Anzahl und Gesamtgröße und zählt die Dateien nur so weit auf, wie es
 * lesbar bleibt.
 */
export function renderProjectFileDigestMail(input: {
  recipientName: string;
  uploaderName: string;
  projectName: string;
  files: Array<{ filename: string; sizeLabel: string }>;
  totalSizeLabel: string;
  url: string;
  unsubscribeUrl: string;
  brand?: MailBrand;
  locale?: Locale;
}): RenderedMail {
  const t = texte(input.locale);
  const intro = t.fileDigestIntro(input.uploaderName, input.files.length, input.projectName);
  // Mehr als zehn Zeilen liest niemand; der Rest steht als Zahl darunter.
  const sichtbar = input.files.slice(0, 10);
  const rest = input.files.length - sichtbar.length;
  const zeilen = sichtbar.map((datei) => t.fileLine(datei.filename, datei.sizeLabel));
  if (rest > 0) zeilen.push(`… +${rest}`);

  return {
    subject: t.fileDigestSubject(input.files.length, input.projectName),
    text: [
      t.hallo(input.recipientName),
      '',
      intro,
      ...zeilen,
      t.fileDigestTotal(input.totalSizeLabel),
      '',
      t.toProjectLine(input.url),
      '',
      t.unsubscribeLine(input.unsubscribeUrl),
    ].join('\n'),
    html: layout({
      brand: input.brand,
      locale: input.locale,
      title: intro,
      body: `${zeilen.map((zeile) => paragraph(zeile)).join('')}${paragraph(
        t.fileDigestTotal(input.totalSizeLabel),
      )}`,
      buttonLabel: t.toProject,
      buttonUrl: input.url,
      unsubscribeUrl: input.unsubscribeUrl,
    }),
  };
}

// ---------- Neue Fassung (Phase 28) ----------

/**
 * „Für X steht v3 bereit."
 *
 * Die Mail, die bis Phase 28 fehlte – bis dahin erfuhr der Kunde von einer
 * neuen Fassung nur, wenn er von selbst hineinsah. Der Knopf führt über
 * `webUrl` **direkt auf die Fassung**, nicht nur aufs Video.
 *
 * `internalNote` steht nur in der Mail ans Team: Für Gäste geht sie erst
 * hinaus, wenn die Fassung freigegeben ist – dort wäre der Hinweis sinnlos.
 */
export function renderVersionReadyMail(input: {
  recipientName: string;
  projectName: string;
  videoName: string;
  versionLabel: string;
  /** Nur fürs Team: Die Fassung ist noch intern. */
  internal?: boolean;
  /** Nur bei einer Freigabe: wer sie durchgewunken hat. */
  releasedBy?: string | null;
  url: string;
  unsubscribeUrl: string;
  brand?: MailBrand;
  locale?: Locale;
}): RenderedMail {
  const t = texte(input.locale);
  const intro = t.versionIntro(input.versionLabel, input.videoName);
  const zusatz = input.internal
    ? t.versionInternalNote
    : input.releasedBy
      ? t.versionReleasedNote(input.releasedBy)
      : null;

  return {
    subject: t.versionSubject(input.versionLabel, input.videoName),
    text: [
      t.hallo(input.recipientName),
      '',
      intro,
      t.project(input.projectName),
      ...(zusatz ? [zusatz] : []),
      '',
      t.watchLine(input.url),
      '',
      t.unsubscribeLine(input.unsubscribeUrl),
    ].join('\n'),
    html: layout({
      brand: input.brand,
      locale: input.locale,
      title: intro,
      body: `${paragraph(t.project(input.projectName))}${zusatz ? paragraph(zusatz) : ''}`,
      buttonLabel: t.watchInPlayer,
      buttonUrl: input.url,
      unsubscribeUrl: input.unsubscribeUrl,
    }),
  };
}

/**
 * „v3 konnte nicht verarbeitet werden." – nur ans Team.
 *
 * Bis Phase 28 bemerkte einen Fehlschlag nur, wer zufällig hinsah: Nach einem
 * Upload über Nacht stand am Morgen nichts da, und niemand wusste warum.
 */
export function renderVersionFailedMail(input: {
  recipientName: string;
  projectName: string;
  videoName: string;
  versionLabel: string;
  reason: string | null;
  url: string;
  unsubscribeUrl: string;
  brand?: MailBrand;
  locale?: Locale;
}): RenderedMail {
  const t = texte(input.locale);
  const intro = t.versionFailedIntro(input.versionLabel, input.videoName);
  const grund = input.reason ? t.versionFailedReason(input.reason) : null;

  return {
    subject: t.versionFailedSubject(input.videoName),
    text: [
      t.hallo(input.recipientName),
      '',
      intro,
      t.project(input.projectName),
      ...(grund ? [grund] : []),
      '',
      t.goThereLine(input.url),
      '',
      t.unsubscribeLine(input.unsubscribeUrl),
    ].join('\n'),
    html: layout({
      brand: input.brand,
      locale: input.locale,
      title: intro,
      body: `${paragraph(t.project(input.projectName))}${grund ? paragraph(grund) : ''}`,
      buttonLabel: t.view,
      buttonUrl: input.url,
      unsubscribeUrl: input.unsubscribeUrl,
    }),
  };
}

// ---------- Kurze Hinweise (Phase 28) ----------

/**
 * Vier Mails, die dasselbe tun: einen Satz sagen und einen Knopf anbieten.
 * Sie teilen sich deshalb einen Rumpf – vier fast gleiche Funktionen
 * nebeneinander wären vier Stellen, an denen dieselbe Änderung nachzuziehen
 * wäre.
 */
function kurzerHinweis(input: {
  recipientName: string;
  subject: string;
  intro: string;
  lines: Array<string | null>;
  buttonLabel: string;
  url: string;
  unsubscribeUrl: string;
  linkLine: (url: string) => string;
  brand?: MailBrand;
  locale?: Locale;
}): RenderedMail {
  const t = texte(input.locale);
  const zeilen = input.lines.filter((zeile): zeile is string => Boolean(zeile));

  return {
    subject: input.subject,
    text: [
      t.hallo(input.recipientName),
      '',
      input.intro,
      ...zeilen,
      '',
      input.linkLine(input.url),
      '',
      t.unsubscribeLine(input.unsubscribeUrl),
    ].join('\n'),
    html: layout({
      brand: input.brand,
      locale: input.locale,
      title: input.intro,
      body: zeilen.map((zeile) => paragraph(zeile)).join(''),
      buttonLabel: input.buttonLabel,
      buttonUrl: input.url,
      unsubscribeUrl: input.unsubscribeUrl,
    }),
  };
}

/** „Der Kunde hat zum ersten Mal reingeschaut." – ans Team. */
export function renderFirstVisitMail(input: {
  recipientName: string;
  guestName: string;
  targetName: string;
  url: string;
  unsubscribeUrl: string;
  brand?: MailBrand;
  locale?: Locale;
}): RenderedMail {
  const t = texte(input.locale);
  return kurzerHinweis({
    ...input,
    subject: t.firstVisitSubject(input.guestName, input.targetName),
    intro: t.firstVisitIntro(input.guestName, input.targetName),
    lines: [],
    buttonLabel: t.toProject,
    linkLine: t.toProjectLine,
  });
}

/**
 * Letzte Warnung vor dem Aufräumen – ans Team.
 *
 * Das Löschen alter Fassungen archivierter Projekte ist der einzige Vorgang,
 * bei dem Klappe von sich aus Material entfernt. Er soll nicht unangekündigt
 * kommen.
 */
export function renderCleanupWarningMail(input: {
  recipientName: string;
  projectName: string;
  days: number;
  versionCount: number;
  url: string;
  unsubscribeUrl: string;
  brand?: MailBrand;
  locale?: Locale;
}): RenderedMail {
  const t = texte(input.locale);
  return kurzerHinweis({
    ...input,
    subject: t.cleanupSubject(input.projectName),
    intro: t.cleanupIntro(input.projectName, input.days),
    lines: [t.cleanupDetail(input.versionCount)],
    buttonLabel: t.toProject,
    linkLine: t.toProjectLine,
  });
}

/** „Die Sicherung ist fehlgeschlagen." – an die Administratoren. */
export function renderBackupFailedMail(input: {
  recipientName: string;
  reason: string | null;
  url: string;
  unsubscribeUrl: string;
  brand?: MailBrand;
  locale?: Locale;
}): RenderedMail {
  const t = texte(input.locale);
  return kurzerHinweis({
    ...input,
    subject: t.backupSubject,
    intro: t.backupIntro,
    lines: [input.reason ? t.backupReason(input.reason) : null],
    buttonLabel: t.view,
    linkLine: t.goThereLine,
  });
}

/** „Ein neues Gerät nutzt dein Konto." – an den Kontoinhaber. */
export function renderDevicePairedMail(input: {
  recipientName: string;
  clientName: string;
  url: string;
  unsubscribeUrl: string;
  brand?: MailBrand;
  locale?: Locale;
}): RenderedMail {
  const t = texte(input.locale);
  return kurzerHinweis({
    ...input,
    subject: t.deviceSubject(input.clientName),
    intro: t.deviceIntro(input.clientName),
    lines: [t.deviceHint],
    buttonLabel: t.view,
    linkLine: t.goThereLine,
  });
}

// ---------- Zugang freigeschaltet (Phase 20) ----------

/**
 * „Du kannst jetzt auch X sehen."
 *
 * Wird verschickt, wenn ein Gast über „Bekannte Gäste" hinzugenommen oder
 * sein Zugriff erweitert wird. Beides passiert ohne neuen Link – bis Phase 19
 * erfuhr der Gast davon deshalb gar nichts, und ein Zugang, von dem niemand
 * weiß, ist keiner.
 *
 * Bewusst ohne Code und ohne Adresse zum Einlösen: Der Gast hat seinen Zugang
 * schon, er meldet sich an wie immer. Eine Mail, die nach einer neuen
 * Einladung aussieht, würde nur die Frage aufwerfen, was mit der alten ist.
 */
export function renderAccessGrantedMail(input: {
  recipientName: string;
  /** Was jetzt offensteht – ein Projektname oder „3 Videos in …". */
  targetName: string;
  /** Wer freigegeben hat; steht im Text, damit die Mail nicht anonym wirkt. */
  actorName: string;
  url: string;
  unsubscribeUrl: string;
  brand?: MailBrand;
  locale?: Locale;
}): RenderedMail {
  const t = texte(input.locale);
  const intro = t.accessIntro(input.actorName, input.targetName);

  return {
    subject: t.accessSubject(input.targetName),
    text: [
      t.hallo(input.recipientName),
      '',
      intro,
      t.accessNoNewLink,
      '',
      t.goThereLine(input.url),
      '',
      t.unsubscribeLine(input.unsubscribeUrl),
    ].join('\n'),
    html: layout({
      brand: input.brand,
      locale: input.locale,
      title: intro,
      body: paragraph(t.accessNoNewLink),
      buttonLabel: t.view,
      buttonUrl: input.url,
      unsubscribeUrl: input.unsubscribeUrl,
    }),
  };
}

// ---------- Testmail ----------

export function renderTestMail(input: {
  host: string;
  fromEmail: string;
  brand?: MailBrand;
  locale?: Locale;
}): RenderedMail {
  const brand = input.brand ?? DEFAULT_MAIL_BRAND;
  const t = texte(input.locale);
  return {
    subject: t.testSubject(brand.title),
    text: [
      t.testIntro(brand.title),
      '',
      t.testServer(input.host),
      t.testFrom(input.fromEmail),
      '',
      t.testSpf,
    ].join('\n'),
    html: layout({
      brand,
      locale: input.locale,
      title: t.testTitle,
      body: [
        paragraph(t.testIntro(brand.title)),
        paragraph(t.testServer(input.host)),
        paragraph(t.testFrom(input.fromEmail)),
        paragraph(t.testSpf),
      ].join(''),
    }),
  };
}
