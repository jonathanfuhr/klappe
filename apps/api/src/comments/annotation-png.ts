/**
 * Zeichnungen als fertiges PNG (Phase 27).
 *
 * Eine Anmerkung liegt auflösungsunabhängig in der Datenbank (Koordinaten
 * 0…1, siehe `packages/shared/src/annotations.ts`). Die Web-App malt sie mit
 * dem Canvas des Browsers; eine Anbindung in DaVinci Resolve hat den nicht –
 * dort läuft eine Python-Umgebung ohne Bildbibliotheken. Deshalb rastert der
 * Server auf Wunsch selbst und liefert ein transparentes PNG im
 * Seitenverhältnis der Fassung.
 *
 * Alles hier ist reine Rechnerei ohne Datenbank und ohne Nest – damit sich
 * das Ergebnis Pixel für Pixel prüfen lässt.
 *
 * Absichtlich ohne fremde Bibliothek: PNG mit 8 Bit RGBA ist ein Header, ein
 * `deflate`-Block und eine Prüfsumme. Das ist weniger Code als die Anbindung
 * einer Bildbibliothek – und es hält den Container klein.
 */
import { deflateSync } from 'node:zlib';
import type { Annotation, AnnotationStroke } from '@klappe/shared';

/** Grenzen für die angeforderte Breite – darunter Matsch, darüber Unfug. */
export const MIN_ANNOTATION_PNG_WIDTH = 64;
export const MAX_ANNOTATION_PNG_WIDTH = 3840;
export const DEFAULT_ANNOTATION_PNG_WIDTH = 1920;

/** Ohne bekannte Maße der Fassung: 16:9, das übliche Format im Haus. */
export const DEFAULT_ASPECT = 16 / 9;

/**
 * Höhe zur angeforderten Breite. Das Seitenverhältnis kommt aus der Fassung;
 * fehlt es (die Datei ist noch in Verarbeitung), gilt 16:9.
 */
export function annotationHeightFor(
  width: number,
  media: { width: number | null; height: number | null },
): number {
  const aspect = media.width && media.height ? media.width / media.height : DEFAULT_ASPECT;
  return Math.max(1, Math.round(width / aspect));
}

/** Die gewünschte Breite in den erlaubten Bereich zwingen. */
export function clampAnnotationWidth(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_ANNOTATION_PNG_WIDTH;
  return Math.max(MIN_ANNOTATION_PNG_WIDTH, Math.min(MAX_ANNOTATION_PNG_WIDTH, Math.round(value)));
}

function hexToRgb(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

/** Abstand eines Punktes zur Strecke A–B; für Strecken der Länge 0 zum Punkt. */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const laenge = dx * dx + dy * dy;
  let t = laenge === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / laenge;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Ein Strich in die Deckungsmaske. Gerechnet wird die Deckung je Pixel aus
 * dem Abstand zur Strecke – das gibt runde Enden, saubere Ecken und eine
 * weiche Kante von rund einem Pixel, ohne dass acht Mal pro Pixel abgetastet
 * werden müsste.
 *
 * Je Strich eine eigene Maske, in die mit `max` eingetragen wird: Sonst
 * addierten sich die Überlappungen zweier Teilstrecken an der Ecke zu einem
 * dunklen Fleck.
 */
function strichInMaske(
  maske: Float32Array,
  breite: number,
  hoehe: number,
  stroke: AnnotationStroke,
): { x0: number; y0: number; x1: number; y1: number } | null {
  // Die Strichstärke ist auf die **Höhe** normalisiert (siehe `annotations.ts`),
  // damit ein Strich bei jedem Seitenverhältnis gleich dick wirkt.
  const radius = Math.max(0.5, (stroke.width * hoehe) / 2);
  const punkte = stroke.points.map((point) => ({ x: point.x * breite, y: point.y * hoehe }));
  if (punkte.length === 0) return null;

  // Ein einzelner Punkt ist ein Tippen – als Strecke der Länge 0 gezeichnet.
  const strecken =
    punkte.length === 1
      ? [{ a: punkte[0], b: punkte[0] }]
      : punkte.slice(1).map((b, index) => ({ a: punkte[index], b }));

  let x0 = breite;
  let y0 = hoehe;
  let x1 = -1;
  let y1 = -1;

  for (const { a, b } of strecken) {
    const von = Math.max(0, Math.floor(Math.min(a.x, b.x) - radius - 1));
    const bis = Math.min(breite - 1, Math.ceil(Math.max(a.x, b.x) + radius + 1));
    const oben = Math.max(0, Math.floor(Math.min(a.y, b.y) - radius - 1));
    const unten = Math.min(hoehe - 1, Math.ceil(Math.max(a.y, b.y) + radius + 1));

    for (let y = oben; y <= unten; y += 1) {
      for (let x = von; x <= bis; x += 1) {
        // Pixelmitte, nicht Pixelecke – sonst sitzt der Strich um einen
        // halben Pixel versetzt.
        const abstand = distanceToSegment(x + 0.5, y + 0.5, a.x, a.y, b.x, b.y);
        const deckung = radius + 0.5 - abstand;
        if (deckung <= 0) continue;
        const wert = deckung > 1 ? 1 : deckung;
        const stelle = y * breite + x;
        if (wert > maske[stelle]) maske[stelle] = wert;
      }
    }

    if (von < x0) x0 = von;
    if (oben < y0) y0 = oben;
    if (bis > x1) x1 = bis;
    if (unten > y1) y1 = unten;
  }

  return x1 < x0 || y1 < y0 ? null : { x0, y0, x1, y1 };
}

/**
 * Die Zeichnung auf eine transparente Fläche malen. Rückgabe sind rohe
 * RGBA-Bytes, Zeile für Zeile – genau das, was das PNG braucht.
 */
export function renderAnnotationRgba(
  annotation: Annotation | null,
  breite: number,
  hoehe: number,
): Uint8Array {
  const bild = new Uint8Array(breite * hoehe * 4);
  if (!annotation) return bild;

  const maske = new Float32Array(breite * hoehe);

  for (const stroke of annotation.strokes) {
    const feld = strichInMaske(maske, breite, hoehe, stroke);
    if (!feld) continue;
    const [r, g, b] = hexToRgb(stroke.color);

    for (let y = feld.y0; y <= feld.y1; y += 1) {
      for (let x = feld.x0; x <= feld.x1; x += 1) {
        const stelle = y * breite + x;
        const deckung = maske[stelle];
        maske[stelle] = 0; // Für den nächsten Strich wieder leer.
        if (deckung <= 0) continue;

        const ziel = stelle * 4;
        const alt = bild[ziel + 3] / 255;
        const neu = deckung + alt * (1 - deckung);
        if (neu <= 0) continue;
        // „source over" auf nicht vormultiplizierten Werten.
        bild[ziel] = Math.round((r * deckung + bild[ziel] * alt * (1 - deckung)) / neu);
        bild[ziel + 1] = Math.round((g * deckung + bild[ziel + 1] * alt * (1 - deckung)) / neu);
        bild[ziel + 2] = Math.round((b * deckung + bild[ziel + 2] * alt * (1 - deckung)) / neu);
        bild[ziel + 3] = Math.round(neu * 255);
      }
    }
  }

  return bild;
}

// ---------- PNG ----------

const CRC_TABELLE = (() => {
  const tabelle = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    tabelle[n] = c >>> 0;
  }
  return tabelle;
})();

function crc32(data: Buffer): number {
  let c = 0xff_ff_ff_ff;
  for (const byte of data) c = CRC_TABELLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xff_ff_ff_ff) >>> 0;
}

/** Ein PNG-Abschnitt: Länge, Typ, Inhalt, Prüfsumme über Typ und Inhalt. */
function chunk(typ: string, inhalt: Buffer): Buffer {
  const kopf = Buffer.alloc(4);
  kopf.writeUInt32BE(inhalt.length, 0);
  const koerper = Buffer.concat([Buffer.from(typ, 'ascii'), inhalt]);
  const pruefsumme = Buffer.alloc(4);
  pruefsumme.writeUInt32BE(crc32(koerper), 0);
  return Buffer.concat([kopf, koerper, pruefsumme]);
}

const PNG_SIGNATUR = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Rohe RGBA-Bytes zu einem PNG mit 8 Bit je Kanal. */
export function encodePng(rgba: Uint8Array, breite: number, hoehe: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr.writeUInt8(8, 8); // Bittiefe
  ihdr.writeUInt8(6, 9); // Farbtyp 6 = Wahrfarben mit Alpha
  ihdr.writeUInt8(0, 10); // Kompression: deflate
  ihdr.writeUInt8(0, 11); // Filterverfahren
  ihdr.writeUInt8(0, 12); // kein Zeilensprung

  // Jede Zeile trägt ihr Filter-Byte vorneweg; 0 heißt „unverändert“. Bei
  // Strichen auf sonst leerer Fläche komprimiert das schon sehr gut – der
  // Aufwand für die Filterwahl lohnt hier nicht.
  const zeilenlaenge = breite * 4;
  const roh = Buffer.alloc((zeilenlaenge + 1) * hoehe);
  for (let y = 0; y < hoehe; y += 1) {
    roh[y * (zeilenlaenge + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * zeilenlaenge, zeilenlaenge).copy(
      roh,
      y * (zeilenlaenge + 1) + 1,
    );
  }

  return Buffer.concat([
    PNG_SIGNATUR,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(roh, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Der ganze Weg in einem Griff: Zeichnung rein, PNG raus. */
export function renderAnnotationPng(
  annotation: Annotation | null,
  breite: number,
  hoehe: number,
): Buffer {
  return encodePng(renderAnnotationRgba(annotation, breite, hoehe), breite, hoehe);
}
