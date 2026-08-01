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

/**
 * Der Name, wie er im Text steht – ohne Zeichen, die das Format zerlegen.
 *
 * Eigene Funktion, weil zwei Stellen sich darauf verlassen müssen: Was das
 * Eingabefeld anzeigt und was beim Absenden gesucht wird. Liefen die
 * auseinander, fände `applyMentions` den Namen nicht wieder und die Zuordnung
 * ginge stillschweigend verloren.
 */
export function mentionLabel(name: string): string {
  return name.replace(/[\]\r\n]/g, ' ').trim() || 'Unbenannt';
}

/** Baut das Token, das der Editor beim Auswählen eines Vorschlags einsetzt. */
export function serializeMention(user: { id: string; name: string }): string {
  return `@[${mentionLabel(user.name)}](${user.id})`;
}

/**
 * Wandelt die im Feld sichtbaren `@Namen` zurück in die eindeutige Schreibweise.
 *
 * Beim Tippen soll dort **nur der Name** stehen: Wer `@[Jonathan Fuhr](3fa8…)`
 * mitten im eigenen Satz sieht, hält das zu Recht für einen Fehler. Die
 * Zuordnung wird deshalb getrennt geführt und erst beim Absenden wieder
 * eingesetzt.
 *
 * Regeln, die dabei zählen:
 *
 * - **Längere Namen zuerst.** Sonst verschluckt „@Jonathan" den Anfang von
 *   „@Jonathan Fuhr" und der Rest bleibt als loser Text stehen.
 * - **Nur an einer Wortgrenze.** `@Jonathan Fuhrs Auto` darf nicht zu
 *   `@[Jonathan Fuhr](…)s Auto` werden.
 * - **Nicht in bestehende Auszeichnungen hinein.** Beim Bearbeiten eines
 *   Kommentars steht die eindeutige Form schon im Text.
 * - Wer den Namen nachträglich ändert, verliert die Zuordnung. Das ist
 *   gewollt: Lieber kein Mention als ein falscher.
 */
export function applyMentions(
  text: string,
  chosen: { label: string; userId: string }[],
): string {
  // Bereits ausgezeichnete Stellen ausklammern, damit sie unberührt bleiben.
  const geschuetzt: string[] = [];
  let rest = text.replace(MENTION_REGEX, (treffer) => {
    geschuetzt.push(treffer);
    return `\u0000${geschuetzt.length - 1}\u0000`;
  });

  const nachLaenge = [...chosen].sort((a, b) => b.label.length - a.label.length);
  for (const mention of nachLaenge) {
    if (!mention.label) continue;
    const gesucht = `@${mention.label}`;
    let ab = 0;
    for (;;) {
      const stelle = rest.indexOf(gesucht, ab);
      if (stelle === -1) break;
      const danach = rest[stelle + gesucht.length];
      // Grenze prüfen: Ein Buchstabe oder eine Ziffer direkt dahinter heißt,
      // dass hier ein längeres Wort steht und nicht dieser Name gemeint ist.
      if (danach !== undefined && /[\p{L}\p{N}]/u.test(danach)) {
        ab = stelle + gesucht.length;
        continue;
      }
      const ersatz = serializeMention({ id: mention.userId, name: mention.label });
      rest = rest.slice(0, stelle) + ersatz + rest.slice(stelle + gesucht.length);
      ab = stelle + ersatz.length;
    }
  }

  return rest.replace(/\u0000(\d+)\u0000/g, (_treffer, index: string) => geschuetzt[Number(index)]);
}
