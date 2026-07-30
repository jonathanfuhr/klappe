import { describe, expect, it } from 'vitest';
import { contentTypeFor, parseRange } from './range';

describe('parseRange', () => {
  it('liefert die ganze Datei ohne Header', () => {
    expect(parseRange(undefined, 1000)).toEqual({ kind: 'full' });
  });

  it('liest einen normalen Bereich', () => {
    expect(parseRange('bytes=0-499', 1000)).toEqual({
      kind: 'partial',
      start: 0,
      end: 499,
      length: 500,
    });
  });

  it('ergänzt ein fehlendes Ende bis zum Dateiende', () => {
    expect(parseRange('bytes=500-', 1000)).toEqual({
      kind: 'partial',
      start: 500,
      end: 999,
      length: 500,
    });
  });

  it('versteht die Suffix-Form für die letzten Bytes', () => {
    expect(parseRange('bytes=-200', 1000)).toEqual({
      kind: 'partial',
      start: 800,
      end: 999,
      length: 200,
    });
  });

  it('begrenzt ein zu großes Ende auf die Dateigröße', () => {
    expect(parseRange('bytes=900-5000', 1000)).toEqual({
      kind: 'partial',
      start: 900,
      end: 999,
      length: 100,
    });
  });

  it('klemmt ein zu großes Suffix auf die ganze Datei', () => {
    expect(parseRange('bytes=-5000', 1000)).toEqual({
      kind: 'partial',
      start: 0,
      end: 999,
      length: 1000,
    });
  });

  it('erkennt unerfüllbare Bereiche', () => {
    expect(parseRange('bytes=1000-', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=900-800', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=-0', 1000)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable' });
  });

  it('ignoriert Formen, die wir nicht bedienen, und liefert die ganze Datei', () => {
    expect(parseRange('bytes=0-99,200-299', 1000)).toEqual({ kind: 'full' });
    expect(parseRange('items=0-99', 1000)).toEqual({ kind: 'full' });
    expect(parseRange('bytes=abc', 1000)).toEqual({ kind: 'full' });
  });

  it('liest den ersten Byte korrekt', () => {
    expect(parseRange('bytes=0-0', 1000)).toEqual({ kind: 'partial', start: 0, end: 0, length: 1 });
  });
});

describe('contentTypeFor', () => {
  it('erkennt die üblichen Video- und Bildformate', () => {
    expect(contentTypeFor('clip.mp4')).toBe('video/mp4');
    expect(contentTypeFor('Clip 01.MOV')).toBe('video/quicktime');
    expect(contentTypeFor('poster.jpg')).toBe('image/jpeg');
  });

  it('fällt bei Unbekanntem auf den Standard zurück', () => {
    expect(contentTypeFor('archiv.zip')).toBe('application/octet-stream');
    expect(contentTypeFor('ohne-endung')).toBe('application/octet-stream');
    expect(contentTypeFor('x.r3d', 'video/x-red')).toBe('video/x-red');
  });
});
