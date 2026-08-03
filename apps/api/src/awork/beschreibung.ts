/**
 * Die Aufgabenbeschreibung in awork (Phase 30).
 *
 * Reine Funktionen, kein HTTP und keine Datenbank – die Beschreibung ist das
 * Sichtbarste an der ganzen Anbindung, und sie soll sich prüfen lassen, ohne
 * dass ein fremdes System dafür laufen muss.
 *
 * **Die Beschreibung gehört vollständig Klappe.** Sie wird bei jedem Sync
 * komplett neu erzeugt, nie ergänzt. Nur so stimmen auch nachträglich
 * geänderte, gelöschte und abgehakte Kommentare – ein angehängter Absatz
 * könnte das nicht. Der Hinweis oben in der Beschreibung sagt das denen, die
 * in awork davorstehen und sonst hineinschreiben würden.
 */

export interface AworkKommentar {
  /** `00:01:23:12` – oder `null` bei einer Anmerkung ohne Zeitbezug. */
  timecode: string | null;
  /** Für die Sortierung; `null` heißt „allgemein". */
  frame: number | null;
  autor: string;
  text: string;
  erledigt: boolean;
  hatZeichnung: boolean;
  antworten: { autor: string; text: string }[];
}

export interface BeschreibungInput {
  /** Vollständige Adresse der Fassung in Klappe. */
  url: string;
  videoName: string;
  /** `v2`, `v2.5` … */
  versionLabel: string;
  kommentare: AworkKommentar[];
}

/**
 * Erst die Anmerkungen ohne Zeitbezug, dann alles der Zeitleiste entlang.
 *
 * Umgekehrt zur Klappe-Oberfläche, wo das Allgemeine hinten hängt: Wer in
 * awork eine Aufgabe aufschlägt, will zuerst wissen, worum es überhaupt geht –
 * und das steht in der allgemeinen Anmerkung, nicht bei Frame 812.
 */
export function sortiereKommentare(kommentare: AworkKommentar[]): AworkKommentar[] {
  return [...kommentare].sort((a, b) => {
    if (a.frame === null && b.frame === null) return 0;
    if (a.frame === null) return -1;
    if (b.frame === null) return 1;
    return a.frame - b.frame;
  });
}

/**
 * Baut das HTML für das Beschreibungsfeld.
 *
 * Bewusst schlichtes Markup – Absatz, Liste, Link, fett. Welche Tags awork im
 * Beschreibungsfeld durchlässt, ist nirgends dokumentiert; was hier steht,
 * überlebt jeden Editor.
 */
export function baueBeschreibung(input: BeschreibungInput): string {
  const teile: string[] = [];

  teile.push(
    `<p><em>Diese Beschreibung pflegt Klappe. Sie wird bei jeder Änderung neu erzeugt – Notizen hier gehen verloren, bitte als Kommentar an die Aufgabe schreiben.</em></p>`,
  );
  teile.push(
    `<p><a href="${escapeAttribut(input.url)}">${escape(input.videoName)} · ${escape(
      input.versionLabel,
    )} in Klappe öffnen</a></p>`,
  );

  const sortiert = sortiereKommentare(input.kommentare);
  if (sortiert.length === 0) {
    teile.push('<p>Derzeit keine offenen Anmerkungen.</p>');
    return teile.join('\n');
  }

  const offen = sortiert.filter((eintrag) => !eintrag.erledigt).length;
  teile.push(
    `<p><strong>${sortiert.length} ${sortiert.length === 1 ? 'Anmerkung' : 'Anmerkungen'}</strong>, davon ${offen} offen.</p>`,
  );

  teile.push('<ul>');
  for (const kommentar of sortiert) {
    teile.push(`  <li>${zeile(kommentar)}${antworten(kommentar)}</li>`);
  }
  teile.push('</ul>');

  return teile.join('\n');
}

function zeile(kommentar: AworkKommentar): string {
  const stuecke: string[] = [];
  // Der Haken steht vorn: In einer langen Liste soll man den Rest überfliegen
  // können, ohne bis zum Zeilenende zu lesen.
  if (kommentar.erledigt) stuecke.push('✓ ');
  if (kommentar.timecode) stuecke.push(`<strong>${escape(kommentar.timecode)}</strong> – `);
  stuecke.push(`<strong>${escape(kommentar.autor)}:</strong> `);
  stuecke.push(escape(kommentar.text));
  // Die Zeichnung selbst lässt sich nicht mitschicken; der Hinweis sagt, dass
  // es sie gibt – der Link oben führt zu ihr.
  if (kommentar.hatZeichnung) stuecke.push(' ✏️');
  return stuecke.join('');
}

function antworten(kommentar: AworkKommentar): string {
  if (kommentar.antworten.length === 0) return '';
  const zeilen = kommentar.antworten.map(
    (antwort) => `      <li><strong>${escape(antwort.autor)}:</strong> ${escape(antwort.text)}</li>`,
  );
  return `\n    <ul>\n${zeilen.join('\n')}\n    </ul>\n  `;
}

/**
 * Der kurze Hinweis, der als Aufgaben-Kommentar hinausgeht, wenn eine
 * bestehende Aufgabe wächst.
 *
 * Ohne ihn bliebe die Erweiterung unbemerkt: awork benachrichtigt bei einem
 * Kommentar, nicht bei einer still geänderten Beschreibung.
 */
export function baueAenderungsHinweis(neue: number, url: string): string {
  const wort = neue === 1 ? 'Anmerkung' : 'Anmerkungen';
  return `${neue} neue ${wort} aus Klappe – die Beschreibung oben ist aktuell. <a href="${escapeAttribut(
    url,
  )}">Fassung öffnen</a>`;
}

/** Der Aufgabentitel: Präfix aus den Einstellungen, Video, Fassung, Runde. */
export function baueAufgabenTitel(input: {
  prefix: string;
  videoName: string;
  versionLabel: string;
  round: number;
}): string {
  const basis = `${input.prefix}${input.videoName} · ${input.versionLabel}`;
  return input.round > 1 ? `${basis} · Runde ${input.round}` : basis;
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Für Attributwerte zusätzlich das einfache Anführungszeichen – der Wert steht
 * zwar in doppelten, aber eine Adresse mit `'` darin soll auch dann nichts
 * aufbrechen, wenn jemand das Markup später umbaut.
 */
function escapeAttribut(text: string): string {
  return escape(text).replace(/'/g, '&#39;');
}
