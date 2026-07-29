/**
 * E-Mail-Vorlagen. Reine Funktionen: Daten rein, Betreff/Text/HTML raus –
 * damit lassen sie sich prüfen, ohne einen Mailserver anzuwerfen.
 *
 * Jede Mail geht als Text *und* als HTML raus. Der Textteil ist nicht bloß
 * Beiwerk: Manche Postfächer zeigen ihn, und er hilft gegen die
 * Spam-Einstufung.
 */

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
}): string {
  const brand = input.brand ?? DEFAULT_MAIL_BRAND;

  const button =
    input.buttonLabel && input.buttonUrl
      ? `<p style="margin:26px 0"><a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;background:${escapeHtml(brand.accent)};color:${escapeHtml(brand.accentContrast)};font-weight:600;text-decoration:none;padding:11px 20px;border-radius:6px">${escapeHtml(input.buttonLabel)}</a></p>`
      : '';

  const footerParts: string[] = [];
  if (input.footerNote) footerParts.push(escapeHtml(input.footerNote));
  if (input.unsubscribeUrl) {
    footerParts.push(
      `<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#6b7482">Benachrichtigungen abbestellen</a>`,
    );
  }

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
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
}): RenderedMail {
  const brand = input.brand ?? DEFAULT_MAIL_BRAND;
  const text = [
    `Dein Anmeldecode für „${input.targetName}“ lautet: ${input.code}`,
    '',
    `Der Code gilt ${input.minutesValid} Minuten.`,
    'Wenn du das nicht angefordert hast, kannst du diese Nachricht ignorieren.',
  ].join('\n');

  return {
    // Der Code steht bewusst im Betreff: Auf dem Handy ist er dann schon in
    // der Vorschau lesbar, ohne die Mail zu öffnen.
    subject: `${input.code} ist dein Anmeldecode für ${brand.title}`,
    text,
    html: layout({
      brand,
      title: 'Dein Anmeldecode',
      body: [
        paragraph(`Für den Zugang zu „${input.targetName}“ brauchst du diesen Code:`),
        `<div style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:32px;letter-spacing:8px;font-weight:700;margin:18px 0;padding:14px;background:#f4f5f7;border-radius:8px;text-align:center">${escapeHtml(input.code)}</div>`,
        paragraph(`Der Code gilt ${input.minutesValid} Minuten.`),
        paragraph('Wenn du das nicht angefordert hast, kannst du diese Nachricht ignorieren.'),
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
}

export function renderCommentMail(input: CommentMailInput): RenderedMail {
  const subject = input.mentioned
    ? `${input.authorName} hat dich erwähnt: ${input.videoName}`
    : input.isReply
      ? `Neue Antwort von ${input.authorName}: ${input.videoName}`
      : `Neuer Kommentar von ${input.authorName}: ${input.videoName}`;

  const intro = input.mentioned
    ? `${input.authorName} hat dich in einem Kommentar zu „${input.videoName}“ erwähnt.`
    : input.isReply
      ? `${input.authorName} hat auf ein Gespräch zu „${input.videoName}“ geantwortet.`
      : `${input.authorName} hat „${input.videoName}“ kommentiert.`;

  const text = [
    `Hallo ${input.recipientName},`,
    '',
    intro,
    `Projekt: ${input.projectName} · Fassung: ${input.versionLabel}`,
    '',
    input.timecode ? `[${input.timecode}]` : '[ohne Zeitbezug]',
    input.body,
    '',
    `Ansehen: ${input.url}`,
    '',
    `Keine solchen Mails mehr: ${input.unsubscribeUrl}`,
  ].join('\n');

  return {
    subject,
    text,
    html: layout({
      brand: input.brand,
      title: intro,
      body: [
        paragraph(`Projekt: ${input.projectName} · Fassung: ${input.versionLabel}`),
        quote(input.body, input.timecode),
      ].join(''),
      buttonLabel: 'Im Player ansehen',
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
}

/** „Anna, Bernd und Clara“ – Aufzählung, wie man sie spricht. */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

/**
 * Ein Block je Kommentar: Wer, zu welcher Fassung, an welcher Stelle. Die
 * Fassung steht dabei, weil eine Sammelmail durchaus Kommentare zu v1 und v2
 * enthalten kann.
 */
function digestEntry(entry: CommentDigestEntry): string {
  const kopf = `${entry.authorName} · ${entry.versionLabel}${entry.mentioned ? ' · dich erwähnt' : ''}`;
  return `<div style="margin:0 0 18px"><div style="font-size:13px;color:#6b7482;margin-bottom:5px">${escapeHtml(kopf)}</div>${quote(entry.body, entry.timecode)}</div>`;
}

export function renderCommentDigestMail(input: CommentDigestMailInput): RenderedMail {
  const anzahl = input.entries.length;
  const erwaehnt = input.entries.some((entry) => entry.mentioned);
  const autoren = joinNames([...new Set(input.entries.map((entry) => entry.authorName))]);

  const kern =
    anzahl === 1
      ? `Ein neuer Kommentar zu „${input.videoName}“`
      : `${anzahl} neue Kommentare zu „${input.videoName}“`;
  // Eine Erwähnung gehört in den Betreff – sonst geht sie in der Sammelmail
  // unter, und genau die ist der Grund, warum jemand sofort hineinschaut.
  const subject = erwaehnt
    ? `Du wurdest erwähnt – ${kern.charAt(0).toLowerCase()}${kern.slice(1)}`
    : kern;

  const intro = `${autoren} ${anzahl === 1 ? 'hat' : 'haben'} „${input.videoName}“ kommentiert.`;

  const text = [
    `Hallo ${input.recipientName},`,
    '',
    intro,
    `Projekt: ${input.projectName}`,
    '',
    ...input.entries.flatMap((entry) => [
      `${entry.authorName} · ${entry.versionLabel}${entry.mentioned ? ' · dich erwähnt' : ''}`,
      entry.timecode ? `[${entry.timecode}]` : '[ohne Zeitbezug]',
      entry.body,
      '',
    ]),
    `Ansehen: ${input.url}`,
    '',
    `Keine solchen Mails mehr: ${input.unsubscribeUrl}`,
  ].join('\n');

  return {
    subject,
    text,
    html: layout({
      brand: input.brand,
      title: intro,
      body: [
        paragraph(`Projekt: ${input.projectName}`),
        input.entries.map(digestEntry).join(''),
      ].join(''),
      buttonLabel: 'Im Player ansehen',
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
}): RenderedMail {
  const intro = `${input.uploaderName} hat Material in „${input.projectName}“ hochgeladen.`;

  return {
    subject: `Neues Material im Projekt ${input.projectName}`,
    text: [
      `Hallo ${input.recipientName},`,
      '',
      intro,
      `Datei: ${input.filename} (${input.sizeLabel})`,
      '',
      `Zum Projekt: ${input.url}`,
      '',
      `Keine solchen Mails mehr: ${input.unsubscribeUrl}`,
    ].join('\n'),
    html: layout({
      brand: input.brand,
      title: intro,
      body: paragraph(`Datei: ${input.filename} (${input.sizeLabel})`),
      buttonLabel: 'Zum Projekt',
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
}): RenderedMail {
  const brand = input.brand ?? DEFAULT_MAIL_BRAND;
  return {
    subject: `${brand.title}: SMTP-Einstellungen funktionieren`,
    text: [
      `Diese Testnachricht bestätigt, dass ${brand.title} über deinen Mailserver versenden kann.`,
      '',
      `Server: ${input.host}`,
      `Absender: ${input.fromEmail}`,
      '',
      'Damit Codes und Benachrichtigungen nicht im Spam landen, sollte die',
      'Absender-Domain SPF und DKIM gesetzt haben.',
    ].join('\n'),
    html: layout({
      brand,
      title: 'SMTP-Einstellungen funktionieren',
      body: [
        paragraph(
          `Diese Testnachricht bestätigt, dass ${brand.title} über deinen Mailserver versenden kann.`,
        ),
        paragraph(`Server: ${input.host}`),
        paragraph(`Absender: ${input.fromEmail}`),
        paragraph(
          'Damit Codes und Benachrichtigungen nicht im Spam landen, sollte die Absender-Domain SPF und DKIM gesetzt haben.',
        ),
      ].join(''),
    }),
  };
}
