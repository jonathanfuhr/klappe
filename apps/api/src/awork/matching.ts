/**
 * Wie ein Klappe-Projekt sein Gegenstück in awork findet (Phase 30).
 *
 * Reine Funktionen ohne Datenbank und ohne HTTP – das ist die eine Stelle, an
 * der entschieden wird, ob zwei Projekte dasselbe meinen, und sie soll sich
 * ohne beide Systeme prüfen lassen.
 *
 * Der Schlüssel ist die **Projektnummer**: ein Freifeld hier wie dort, in
 * derselben Schreibweise gepflegt. Der Kundenname ist nur die Gegenprobe –
 * Projektnamen weichen zwischen den Systemen regelmäßig ab und taugen gar
 * nicht.
 */

/**
 * Der awork-Projekt-Key (`UBEI`, `ENSS`) – seit 1.5.2 der Schlüssel der
 * Zuordnung.
 *
 * awork vergibt ihn für jedes Projekt von sich aus und hält ihn eindeutig;
 * niemand muss ihn abtippen. Vorher lief die Zuordnung über eine selbst
 * gepflegte Projektnummer – die gibt es weiterhin, sie wandert aber nur noch
 * als Wert herüber und entscheidet nichts mehr.
 *
 * Verglichen wird großgeschrieben und ohne Leerraum: In das Klappe-Feld tippt
 * ihn im Zweifel doch jemand von Hand ab.
 */
export function normalisiereProjektKey(wert: string | null | undefined): string {
  if (!wert) return '';
  return wert.replace(/\s/g, '').toUpperCase();
}

/**
 * Welche awork-Projekttypen geholt werden. Leere Liste heißt **alle** – so
 * verhält sich eine Anlage, in der nie jemand etwas ausgewählt hat, wie
 * vorher.
 */
export function parseProjektTypen(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set(text.split(',').map((eintrag) => eintrag.trim()).filter(Boolean))];
}

/**
 * Soll dieser Projekttyp geholt werden? Projekte ohne Typ zählen als
 * ausgewählt, solange nichts eingeschränkt ist – sonst verschwänden sie
 * stillschweigend, obwohl niemand sie ausgeschlossen hat.
 */
export function typErlaubt(projectTypeId: string | null, erlaubte: string[]): boolean {
  if (erlaubte.length === 0) return true;
  if (!projectTypeId) return false;
  return erlaubte.includes(projectTypeId);
}

/**
 * Projektnummern werden großgeschrieben und ohne Trenner verglichen.
 * `j26q3p0153`, `J26Q3P0153` und `J26 Q3 P0153` sind dieselbe Nummer – wer sie
 * abtippt, setzt Leerzeichen und Bindestriche nach Gefühl.
 */
export function normalisiereProjektnummer(wert: string | null | undefined): string {
  if (!wert) return '';
  return wert.replace(/[\s\-_./]/g, '').toUpperCase();
}

/**
 * Kundennamen werden kleingeschrieben verglichen, Mehrfach-Leerzeichen fallen
 * zusammen. Bewusst **keine** Umlaut-Ersetzung: „Müller" und „Mueller" sind
 * verschiedene Schreibweisen desselben Hauses, aber das zu entscheiden ist
 * Sache eines Menschen – hier führt es nur dazu, dass die Gegenprobe schweigt.
 */
export function normalisiereKunde(wert: string | null | undefined): string {
  if (!wert) return '';
  return wert.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Passen die Kundennamen zusammen?
 *
 * Fehlt einer der beiden, gilt das als „keine Aussage" und damit als
 * bestanden: In awork hängt die Firma am Projekt, in Klappe ist der Kunde ein
 * freies Textfeld – dass eines von beiden leer bleibt, ist Alltag und kein
 * Widerspruch.
 */
export function kundenPassen(a: string | null | undefined, b: string | null | undefined): boolean {
  const links = normalisiereKunde(a);
  const rechts = normalisiereKunde(b);
  if (!links || !rechts) return true;
  return links === rechts;
}

export interface AworkKandidat {
  id: string;
  name: string;
  companyName: string | null;
  /** Der awork-Projekt-Key – seit 1.5.2 der Schlüssel. */
  projectKey: string | null;
  /** Nur noch ein Wert, der herüberwandert; entscheidet nichts mehr. */
  projectNumber: string | null;
}

export type ProjektTreffer =
  /** Genau ein Projekt mit diesem Key, Kunde passt (oder schweigt). */
  | { art: 'treffer'; kandidat: AworkKandidat }
  /**
   * Key gefunden, aber der Kunde widerspricht. Wird **nicht** stillschweigend
   * übernommen: Eine falsche Zuordnung schreibt Korrekturen ins Projekt eines
   * fremden Kunden.
   */
  | { art: 'kunde-abweichend'; kandidat: AworkKandidat; erwartet: string; gefunden: string }
  /**
   * Mehrere Projekte tragen denselben Key. In awork kommt das nicht vor – er
   * ist dort eindeutig –, wohl aber, wenn jemand ihn in Klappe von Hand
   * abgetippt hat. Dann klärt es ein Mensch.
   */
  | { art: 'mehrdeutig'; kandidaten: AworkKandidat[] }
  /** Kein Projekt-Key am Klappe-Projekt. */
  | { art: 'ohne-key' }
  /** Key da, aber in awork gibt es dazu nichts. */
  | { art: 'kein-treffer'; key: string };

/**
 * Sucht das passende awork-Projekt – über den Projekt-Key (1.5.2).
 *
 * Die Kandidatenliste ist die **vollständige** awork-Projektliste; gefiltert
 * wird hier, damit die Regel an einer Stelle steht und prüfbar bleibt.
 */
export function findeProjekt(
  projektKey: string | null | undefined,
  kunde: string | null | undefined,
  kandidaten: AworkKandidat[],
): ProjektTreffer {
  const key = normalisiereProjektKey(projektKey);
  if (!key) return { art: 'ohne-key' };

  const treffer = kandidaten.filter(
    (kandidat) => normalisiereProjektKey(kandidat.projectKey) === key,
  );
  if (treffer.length === 0) return { art: 'kein-treffer', key };
  if (treffer.length > 1) return { art: 'mehrdeutig', kandidaten: treffer };

  const kandidat = treffer[0];
  if (!kundenPassen(kunde, kandidat.companyName)) {
    return {
      art: 'kunde-abweichend',
      kandidat,
      erwartet: kunde?.trim() ?? '',
      gefunden: kandidat.companyName?.trim() ?? '',
    };
  }
  return { art: 'treffer', kandidat };
}

/**
 * Ausschluss-Begriffe (1.5.1).
 *
 * Manche awork-Projekte gehen Klappe nichts an – ein Kunde, der nie darüber
 * versendet, eine Projektart, die kein Review braucht. Statt jedes einzelne
 * Projekt von Hand wegzuräumen, steht in den Einstellungen eine Liste von
 * Begriffen; wer einen davon im Namen, beim Kunden oder in der Projektnummer
 * trägt, wird beim Abholen übersprungen.
 *
 * Eingegeben wird zeilen- oder kommagetrennt – beides, weil beides natürlich
 * ist und niemand nachlesen soll, welches gilt.
 */
export function parseAusschluss(text: string | null | undefined): string[] {
  if (!text) return [];
  return [
    ...new Set(
      text
        .split(/[\n,;]/)
        .map((eintrag) => eintrag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/**
 * Trägt dieses Projekt einen der Ausschluss-Begriffe? Gibt den **treffenden**
 * Begriff zurück, nicht nur `true`: Im Protokoll steht dann, warum ein
 * Projekt übersprungen wurde – sonst sucht man den Grund in der falschen Liste.
 *
 * Verglichen wird als Teilzeichenkette und ohne Rücksicht auf Groß- und
 * Kleinschreibung: „beispiel" fängt auch „Beispiel GmbH & Co. KG". Das ist die
 * Erwartung an ein Ausschlussfeld – wer genauer zielen will, schreibt mehr
 * hin.
 */
export function ausschlussGrund(
  projekt: { name?: string | null; companyName?: string | null; projectNumber?: string | null },
  begriffe: string[],
): string | null {
  if (begriffe.length === 0) return null;

  const felder = [projekt.name, projekt.companyName, projekt.projectNumber]
    .filter((wert): wert is string => Boolean(wert))
    .map((wert) => wert.toLowerCase());
  if (felder.length === 0) return null;

  for (const begriff of begriffe) {
    if (felder.some((feld) => feld.includes(begriff))) return begriff;
  }
  return null;
}

/** Den Wert eines Freifelds aus einer awork-Freifeldliste ziehen. */
export function freifeldWert(
  felder: { customFieldDefinitionId: string; textValue?: string | null }[] | null | undefined,
  definitionId: string | null | undefined,
): string | null {
  if (!definitionId || !felder) return null;
  const eintrag = felder.find((feld) => feld.customFieldDefinitionId === definitionId);
  const wert = eintrag?.textValue?.trim();
  return wert ? wert : null;
}
