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

/** Kurze Kante der Stufe → Bitrate. Werte aus der Praxis für H.264. */
const RUNGS: { shortEdge: number; bitrateBps: number }[] = [
  { shortEdge: 2160, bitrateBps: 16_000_000 },
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
