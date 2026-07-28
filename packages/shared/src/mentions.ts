/**
 * @-Mentions in Kommentaren.
 *
 * Ein Mention wird im gespeicherten Text als `@[Anzeigename](benutzer-id)`
 * abgelegt. Der Vorteil gegenüber einem bloßen `@name`: Die Zuordnung bleibt
 * eindeutig, auch wenn zwei Personen gleich heißen oder jemand später
 * umbenannt wird. Server und Browser benutzen denselben Parser – sonst
 * würden Benachrichtigungen und Darstellung auseinanderlaufen.
 */

/** UUID in der Klammer, Anzeigename ohne `]` in den eckigen Klammern. */
const MENTION_REGEX =
  /@\[([^\]\n]{1,200})\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

export interface ParsedMention {
  userId: string;
  label: string;
  start: number;
  end: number;
}

export type CommentToken =
  | { type: 'text'; value: string }
  | { type: 'mention'; userId: string; label: string };

/** Alle Mentions mit Position im Text, in Reihenfolge des Vorkommens. */
export function parseMentions(body: string): ParsedMention[] {
  const result: ParsedMention[] = [];
  for (const match of body.matchAll(MENTION_REGEX)) {
    result.push({
      label: match[1],
      userId: match[2].toLowerCase(),
      start: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
    });
  }
  return result;
}

/** Eindeutige Benutzer-IDs – Grundlage für Benachrichtigungen. */
export function mentionedUserIds(body: string): string[] {
  return [...new Set(parseMentions(body).map((mention) => mention.userId))];
}

/** Zerlegt den Text in Stücke, damit die Oberfläche Mentions hervorheben kann. */
export function tokenizeCommentBody(body: string): CommentToken[] {
  const tokens: CommentToken[] = [];
  let cursor = 0;

  for (const mention of parseMentions(body)) {
    if (mention.start > cursor) {
      tokens.push({ type: 'text', value: body.slice(cursor, mention.start) });
    }
    tokens.push({ type: 'mention', userId: mention.userId, label: mention.label });
    cursor = mention.end;
  }

  if (cursor < body.length) {
    tokens.push({ type: 'text', value: body.slice(cursor) });
  }
  return tokens;
}

/** Kommentartext ohne Auszeichnung – für E-Mails und Listenvorschauen. */
export function commentBodyToPlainText(body: string): string {
  return body.replace(MENTION_REGEX, (_match, label: string) => `@${label}`);
}

/** Baut das Token, das der Editor beim Auswählen eines Vorschlags einsetzt. */
export function serializeMention(user: { id: string; name: string }): string {
  // Zeilenumbrüche und `]` würden das Format zerlegen.
  const label = user.name.replace(/[\]\r\n]/g, ' ').trim() || 'Unbenannt';
  return `@[${label}](${user.id})`;
}
