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
}): string {
  const button =
    input.buttonLabel && input.buttonUrl
      ? `<p style="margin:26px 0"><a href="${escapeHtml(input.buttonUrl)}" style="display:inline-block;background:#4c8dff;color:#04070d;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:6px">${escapeHtml(input.buttonLabel)}</a></p>`
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
    <div style="font-weight:650;font-size:17px;margin-bottom:18px">Klappe</div>
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
}): RenderedMail {
  const text = [
    `Dein Anmeldecode für „${input.targetName}“ lautet: ${input.code}`,
    '',
    `Der Code gilt ${input.minutesValid} Minuten.`,
    'Wenn du das nicht angefordert hast, kannst du diese Nachricht ignorieren.',
  ].join('\n');

  return {
    // Der Code steht bewusst im Betreff: Auf dem Handy ist er dann schon in
    // der Vorschau lesbar, ohne die Mail zu öffnen.
    subject: `${input.code} ist dein Anmeldecode für Klappe`,
    text,
    html: layout({
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

// ---------- Kunden-Upload ----------

export function renderProjectFileMail(input: {
  recipientName: string;
  uploaderName: string;
  projectName: string;
  filename: string;
  sizeLabel: string;
  url: string;
  unsubscribeUrl: string;
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
      title: intro,
      body: paragraph(`Datei: ${input.filename} (${input.sizeLabel})`),
      buttonLabel: 'Zum Projekt',
      buttonUrl: input.url,
      unsubscribeUrl: input.unsubscribeUrl,
    }),
  };
}

// ---------- Testmail ----------

export function renderTestMail(input: { host: string; fromEmail: string }): RenderedMail {
  return {
    subject: 'Klappe: SMTP-Einstellungen funktionieren',
    text: [
      'Diese Testnachricht bestätigt, dass Klappe über deinen Mailserver versenden kann.',
      '',
      `Server: ${input.host}`,
      `Absender: ${input.fromEmail}`,
      '',
      'Damit Codes und Benachrichtigungen nicht im Spam landen, sollte die',
      'Absender-Domain SPF und DKIM gesetzt haben.',
    ].join('\n'),
    html: layout({
      title: 'SMTP-Einstellungen funktionieren',
      body: [
        paragraph('Diese Testnachricht bestätigt, dass Klappe über deinen Mailserver versenden kann.'),
        paragraph(`Server: ${input.host}`),
        paragraph(`Absender: ${input.fromEmail}`),
        paragraph(
          'Damit Codes und Benachrichtigungen nicht im Spam landen, sollte die Absender-Domain SPF und DKIM gesetzt haben.',
        ),
      ].join(''),
    }),
  };
}
