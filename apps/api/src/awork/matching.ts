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
  projectNumber: string | null;
}

export type ProjektTreffer =
  /** Genau ein Projekt mit dieser Nummer, Kunde passt (oder schweigt). */
  | { art: 'treffer'; kandidat: AworkKandidat }
  /**
   * Nummer gefunden, aber der Kunde widerspricht. Wird **nicht** stillschweigend
   * übernommen: Eine falsche Zuordnung schreibt Korrekturen ins Projekt eines
   * fremden Kunden.
   */
  | { art: 'kunde-abweichend'; kandidat: AworkKandidat; erwartet: string; gefunden: string }
  /** Mehrere Projekte tragen dieselbe Nummer – das muss ein Mensch klären. */
  | { art: 'mehrdeutig'; kandidaten: AworkKandidat[] }
  /** Keine Projektnummer am Klappe-Projekt. */
  | { art: 'ohne-nummer' }
  /** Nummer da, aber in awork gibt es dazu nichts. */
  | { art: 'kein-treffer'; nummer: string };

/**
 * Sucht das passende awork-Projekt.
 *
 * Die Kandidatenliste ist die **vollständige** awork-Projektliste; gefiltert
 * wird hier, damit die Regel an einer Stelle steht und prüfbar bleibt.
 */
export function findeProjekt(
  projektnummer: string | null | undefined,
  kunde: string | null | undefined,
  kandidaten: AworkKandidat[],
): ProjektTreffer {
  const nummer = normalisiereProjektnummer(projektnummer);
  if (!nummer) return { art: 'ohne-nummer' };

  const treffer = kandidaten.filter(
    (kandidat) => normalisiereProjektnummer(kandidat.projectNumber) === nummer,
  );
  if (treffer.length === 0) return { art: 'kein-treffer', nummer };
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
