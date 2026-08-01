import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ANNOTATION_PNG_WIDTH,
  MAX_ANNOTATION_PNG_WIDTH,
  MIN_ANNOTATION_PNG_WIDTH,
  annotationHeightFor,
  clampAnnotationWidth,
  encodePng,
  renderAnnotationPng,
  renderAnnotationRgba,
} from './annotation-png';

/** Farbe und Deckkraft eines Pixels aus den rohen RGBA-Bytes. */
function pixel(rgba: Uint8Array, breite: number, x: number, y: number) {
  const stelle = (y * breite + x) * 4;
  return {
    r: rgba[stelle],
    g: rgba[stelle + 1],
    b: rgba[stelle + 2],
    a: rgba[stelle + 3],
  };
}

describe('Breite und Höhe', () => {
  it('nimmt die Vorgabe, wenn nichts angefragt wurde', () => {
    expect(clampAnnotationWidth(undefined)).toBe(DEFAULT_ANNOTATION_PNG_WIDTH);
    expect(clampAnnotationWidth(Number.NaN)).toBe(DEFAULT_ANNOTATION_PNG_WIDTH);
  });

  it('hält sich an die Grenzen', () => {
    expect(clampAnnotationWidth(10)).toBe(MIN_ANNOTATION_PNG_WIDTH);
    expect(clampAnnotationWidth(99_999)).toBe(MAX_ANNOTATION_PNG_WIDTH);
    expect(clampAnnotationWidth(1280.4)).toBe(1280);
  });

  it('folgt dem Seitenverhältnis der Fassung', () => {
    expect(annotationHeightFor(1920, { width: 3840, height: 2160 })).toBe(1080);
    expect(annotationHeightFor(1000, { width: 1000, height: 1000 })).toBe(1000);
    // Hochkant vom Handy – die Höhe darf größer sein als die Breite.
    expect(annotationHeightFor(1080, { width: 1080, height: 1920 })).toBe(1920);
  });

  it('nimmt 16:9, solange die Maße fehlen', () => {
    expect(annotationHeightFor(1920, { width: null, height: null })).toBe(1080);
  });
});

describe('Rastern', () => {
  it('lässt eine leere Zeichnung durchsichtig', () => {
    const bild = renderAnnotationRgba(null, 8, 8);
    expect(bild.every((byte) => byte === 0)).toBe(true);
  });

  it('malt einen waagerechten Strich in seiner Farbe', () => {
    const bild = renderAnnotationRgba(
      {
        strokes: [
          {
            color: '#ff3b30',
            width: 0.1,
            points: [
              { x: 0.1, y: 0.5 },
              { x: 0.9, y: 0.5 },
            ],
          },
        ],
      },
      100,
      100,
    );

    const mitte = pixel(bild, 100, 50, 50);
    expect(mitte.a).toBe(255);
    expect([mitte.r, mitte.g, mitte.b]).toEqual([0xff, 0x3b, 0x30]);

    // Oben und unten bleibt die Fläche frei.
    expect(pixel(bild, 100, 50, 5).a).toBe(0);
    expect(pixel(bild, 100, 5, 5).a).toBe(0);
  });

  it('zeichnet ein Tippen als runden Punkt', () => {
    const bild = renderAnnotationRgba(
      { strokes: [{ color: '#ffffff', width: 0.2, points: [{ x: 0.5, y: 0.5 }] }] },
      60,
      60,
    );
    expect(pixel(bild, 60, 30, 30).a).toBe(255);
    expect(pixel(bild, 60, 0, 0).a).toBe(0);
  });

  it('deckt an einer Ecke nicht doppelt', () => {
    // Zwei Teilstrecken treffen sich; an der Ecke darf nichts dunkler werden
    // als die volle Deckkraft – sonst wäre die Maske addiert statt maximiert.
    const bild = renderAnnotationRgba(
      {
        strokes: [
          {
            color: '#32ade6',
            width: 0.08,
            points: [
              { x: 0.2, y: 0.5 },
              { x: 0.5, y: 0.5 },
              { x: 0.5, y: 0.8 },
            ],
          },
        ],
      },
      100,
      100,
    );
    const ecke = pixel(bild, 100, 50, 50);
    expect(ecke.a).toBe(255);
    expect([ecke.r, ecke.g, ecke.b]).toEqual([0x32, 0xad, 0xe6]);
  });

  it('skaliert die Strichstärke mit der Höhe', () => {
    const schmal = renderAnnotationRgba(
      {
        strokes: [
          {
            color: '#000000',
            width: 0.1,
            points: [
              { x: 0.5, y: 0.2 },
              { x: 0.5, y: 0.8 },
            ],
          },
        ],
      },
      200,
      200,
    );
    // Halbe Strichstärke von 0.1 · 200 px = 10 px nach jeder Seite.
    expect(pixel(schmal, 200, 100 + 8, 100).a).toBe(255);
    expect(pixel(schmal, 200, 100 + 14, 100).a).toBe(0);
  });
});

describe('PNG', () => {
  it('schreibt Signatur, Maße und Farbtyp', () => {
    const png = encodePng(new Uint8Array(4 * 4 * 4), 4, 4);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(4);
    expect(png.readUInt32BE(20)).toBe(4);
    expect(png.readUInt8(24)).toBe(8); // Bittiefe
    expect(png.readUInt8(25)).toBe(6); // RGBA
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
  });

  it('gibt die Pixel unverändert wieder her', () => {
    const breite = 3;
    const hoehe = 2;
    const rgba = new Uint8Array(breite * hoehe * 4);
    for (let i = 0; i < rgba.length; i += 1) rgba[i] = (i * 7) % 256;

    const png = encodePng(rgba, breite, hoehe);

    // IDAT heraussuchen und auspacken – jede Zeile trägt ihr Filter-Byte 0.
    let stelle = 8;
    let daten: Buffer | null = null;
    while (stelle < png.length) {
      const laenge = png.readUInt32BE(stelle);
      const typ = png.subarray(stelle + 4, stelle + 8).toString('ascii');
      if (typ === 'IDAT') daten = png.subarray(stelle + 8, stelle + 8 + laenge);
      stelle += laenge + 12;
    }
    expect(daten).not.toBeNull();

    const roh = inflateSync(daten as Buffer);
    expect(roh.length).toBe((breite * 4 + 1) * hoehe);
    for (let y = 0; y < hoehe; y += 1) {
      expect(roh[y * (breite * 4 + 1)]).toBe(0);
      const zeile = roh.subarray(y * (breite * 4 + 1) + 1, (y + 1) * (breite * 4 + 1));
      expect([...zeile]).toEqual([...rgba.subarray(y * breite * 4, (y + 1) * breite * 4)]);
    }
  });

  it('liefert für dieselbe Zeichnung Byte für Byte dasselbe Bild', () => {
    const zeichnung = {
      strokes: [
        {
          color: '#ffcc00',
          width: 0.05,
          points: [
            { x: 0.1, y: 0.1 },
            { x: 0.9, y: 0.9 },
          ],
        },
      ],
    };
    // Grundlage für den ETag: Gleiche Eingabe, gleiche Antwort.
    expect(renderAnnotationPng(zeichnung, 64, 36).equals(renderAnnotationPng(zeichnung, 64, 36))).toBe(
      true,
    );
  });
});
