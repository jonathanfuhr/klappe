/**
 * Stufenleiter für die adaptive Wiedergabe (Phase 13, „Ausbaustufe“ aus dem
 * Konzept).
 *
 * Der progressive Proxy bleibt der Normalfall: Er ist frame-genau, sofort
 * springbar und kostet einen Durchlauf. HLS kommt zusätzlich dazu, wenn es
 * eingeschaltet ist – für Kunden mit schwacher Leitung, die lieber eine
 * kleinere Stufe sehen als einen Ruckler.
 *
 * Reine Rechnerei, damit sich die Leiter ohne ffmpeg prüfen lässt.
 */

export interface LadderRung {
  /** Name der Stufe, zugleich Verzeichnisname: `1080p`. */
  name: string;
  width: number;
  height: number;
  /** Zielbitrate in Bit pro Sekunde. */
  bitrateBps: number;
  /** Spitzenbitrate, die der Player einplanen muss. */
  maxrateBps: number;
}

/**
 * Kurze Kante der Stufe → Bitrate. Werte aus der Praxis für H.264.
 *
 * **2160p ist seit 1.7.1 nicht mehr dabei.** Die Stufe war mit 16 Mbit/s
 * angesetzt, und niemand hat sie je bekommen: Gemessen am 14.08.2026 liefert
 * der Cloudflare-Tunnel, über den die Kunden hereinkommen, 1,7 bis 4,1
 * Mbit/s – bei Leitungen, die an beiden Enden das Zwanzigfache könnten. Eine
 * Stufe, die viermal über dem liegt, was durch den Weg passt, kostet
 * Rechenzeit beim Erzeugen, Platz auf der Platte und im schlechtesten Fall
 * eine Minute Wartezeit, wenn der Player sie doch einmal anfasst.
 *
 * Wer sie zurückwill, hängt sie hier wieder ein – die Leiter richtet sich im
 * Übrigen von selbst nach der Quelle. Sinnvoll wird das, sobald die Medien
 * nicht mehr durch den Tunnel gehen.
 *
 * 1080p bleibt die Obergrenze und deckt sich damit mit dem progressiven
 * Proxy; darunter geht es für schwache Leitungen weiter.
 */
const RUNGS: { shortEdge: number; bitrateBps: number }[] = [
  { shortEdge: 1080, bitrateBps: 6_000_000 },
  { shortEdge: 720, bitrateBps: 3_000_000 },
  { shortEdge: 480, bitrateBps: 1_400_000 },
];

function toEven(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * Baut die Leiter für ein Quellformat.
 *
 * Regeln: nie hochskalieren, das Seitenverhältnis behalten, und die oberste
 * Stufe nur dann, wenn die Quelle sie wirklich hergibt. Bei Hochformat zählt
 * – wie überall in Klappe – die kurze Kante.
 */
export function planLadder(
  sourceWidth: number,
  sourceHeight: number,
  options: { maxShortEdge?: number } = {},
): LadderRung[] {
  if (sourceWidth <= 0 || sourceHeight <= 0) return [];

  const shortEdge = Math.min(sourceWidth, sourceHeight);
  const obergrenze = Math.min(shortEdge, options.maxShortEdge ?? shortEdge);
  const hochformat = sourceHeight > sourceWidth;

  const stufen: LadderRung[] = [];
  for (const rung of RUNGS) {
    if (rung.shortEdge > obergrenze) continue;

    const faktor = rung.shortEdge / shortEdge;
    const width = toEven(sourceWidth * faktor);
    const height = toEven(sourceHeight * faktor);

    stufen.push({
      name: `${rung.shortEdge}p`,
      width,
      height,
      bitrateBps: rung.bitrateBps,
      // Etwas Luft nach oben, sonst greift der Deckel in Bewegtszenen zu hart.
      maxrateBps: Math.round(rung.bitrateBps * 1.2),
    });
  }

  // Sehr kleine Quellen fielen sonst ganz durch – eine Stufe braucht es.
  if (stufen.length === 0) {
    stufen.push({
      name: `${obergrenze}p`,
      width: toEven(sourceWidth),
      height: toEven(sourceHeight),
      bitrateBps: 1_400_000,
      maxrateBps: 1_680_000,
    });
  }

  // Hochformat ändert nichts an der Reihenfolge, nur an den Kantenlängen –
  // die Prüfung hier ist reine Absicherung gegen Rechenfehler oben.
  if (hochformat && stufen.some((stufe) => stufe.width > stufe.height)) {
    throw new RangeError('Hochformat-Leiter ist ins Querformat gekippt.');
  }

  return stufen;
}

/**
 * Master-Playlist mit allen Stufen. Der Player wählt selbst – deshalb müssen
 * Bandbreite und Auflösung stimmen, sonst greift er daneben.
 */
export function buildMasterPlaylist(rungs: LadderRung[]): string {
  const zeilen = ['#EXTM3U', '#EXT-X-VERSION:3'];

  for (const rung of rungs) {
    zeilen.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${rung.maxrateBps},AVERAGE-BANDWIDTH=${rung.bitrateBps},RESOLUTION=${rung.width}x${rung.height},CODECS="avc1.640028,mp4a.40.2"`,
      `${rung.name}/index.m3u8`,
    );
  }

  return `${zeilen.join('\n')}\n`;
}

/** Die oberste Stufe, die eine Leiter überhaupt anbieten darf. */
export const MAX_LADDER_SHORT_EDGE = RUNGS[0].shortEdge;

/**
 * Stufen aus einer **bestehenden** Master-Playlist herausnehmen, die zu groß
 * für den Weg sind (1.7.8).
 *
 * Der Grund ist ein Fehler, der sich nur bei Safari zeigte. Dort läuft HLS
 * **nativ** im `<video>`-Element – `hls.js` wird gar nicht erst geladen, und
 * damit greift auch keine seiner Einstellungen. Der Deckel auf die
 * Fenstergröße aus 1.7.1 wirkt in Chrome und Firefox, in Safari nicht. Safari
 * sieht die 2160p-Stufe, hält die Leitung für schnell genug und holt sie: ein
 * Segment von rund 12 MB. Bei knapp 2 MB/s sind das sieben Sekunden Standbild
 * mitten im Film, und Springen in der Zeitleiste wird unmöglich.
 *
 * Seit 1.7.1 entstehen neue Leitern ohne 2160p – die **bestehenden** behalten
 * sie aber, denn die Leiter wird beim Transcodieren gebaut und nicht
 * nachträglich umgeschrieben. Neu zu verarbeiten wären Stunden Rechenzeit für
 * Material, das längst fertig ist.
 *
 * Deshalb hier: Beim Ausliefern der Master-Playlist fliegt heraus, was über
 * der Leiter liegt. Die Dateien bleiben liegen, wo sie sind – sie werden nur
 * nicht mehr angeboten. Das wirkt sofort, für jedes vorhandene Video und für
 * jeden Player, auch für die, die sich selbst bedienen.
 *
 * Lässt sich die Playlist nicht deuten, kommt sie unverändert zurück: Ein
 * Video, das aussetzt, ist ärgerlich – eines, das gar nicht mehr läuft, ist
 * schlimmer.
 */
export function filterMasterPlaylist(
  text: string,
  maxShortEdge: number = MAX_LADDER_SHORT_EDGE,
): string {
  const zeilen = text.split(/\r?\n/);
  const ergebnis: string[] = [];

  for (let i = 0; i < zeilen.length; i += 1) {
    const zeile = zeilen[i];

    if (!zeile.startsWith('#EXT-X-STREAM-INF')) {
      ergebnis.push(zeile);
      continue;
    }

    // Auf die Kennzeile folgt die Adresse der Stufe; beide gehören zusammen
    // und müssen gemeinsam bleiben oder gemeinsam verschwinden.
    const adresse = zeilen[i + 1];
    const treffer = /RESOLUTION=(\d+)x(\d+)/.exec(zeile);

    // Ohne Auflösung lässt sich nicht entscheiden – dann bleibt die Stufe.
    if (!treffer || adresse === undefined) {
      ergebnis.push(zeile);
      continue;
    }

    // Wie überall in Klappe zählt die kurze Kante; im Hochformat ist das die
    // Breite.
    const kurzeKante = Math.min(Number(treffer[1]), Number(treffer[2]));
    if (kurzeKante <= maxShortEdge) {
      ergebnis.push(zeile, adresse);
    }
    i += 1;
  }

  // Bliebe nichts übrig, wäre die Playlist wertlos – dann lieber die
  // ursprüngliche, mit der wenigstens etwas läuft.
  if (!ergebnis.some((zeile) => zeile.startsWith('#EXT-X-STREAM-INF'))) return text;

  return ergebnis.join('\n');
}

/**
 * Länge eines Segments in Sekunden. Kurze Segmente lassen den Player
 * schneller auf eine andere Stufe wechseln, erzeugen aber mehr Dateien;
 * vier Sekunden sind der übliche Kompromiss.
 */
export const SEGMENT_SECONDS = 4;

/** Erlaubte Dateinamen unterhalb eines HLS-Verzeichnisses. */
export function isSafeHlsFilename(name: string): boolean {
  return /^[a-zA-Z0-9_-]+\.(m3u8|ts|m4s|mp4)$/.test(name);
}
