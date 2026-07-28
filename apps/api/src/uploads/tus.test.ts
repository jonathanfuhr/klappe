import { describe, expect, it } from 'vitest';
import {
  checkOffset,
  encodeUploadMetadata,
  filenameFromMetadata,
  parseNonNegativeInteger,
  parseUploadMetadata,
} from './tus';

describe('parseUploadMetadata', () => {
  it('liest Base64-Werte aus dem Header', () => {
    const header = `filename ${Buffer.from('Clip 01.mov').toString('base64')},filetype ${Buffer.from('video/quicktime').toString('base64')}`;
    expect(parseUploadMetadata(header)).toEqual({
      filename: 'Clip 01.mov',
      filetype: 'video/quicktime',
    });
  });

  it('versteht Schlüssel ohne Wert', () => {
    expect(parseUploadMetadata('is_confidential')).toEqual({ is_confidential: '' });
  });

  it('kommt mit Umlauten klar', () => {
    const header = encodeUploadMetadata({ filename: 'Grün Küche.mov' });
    expect(parseUploadMetadata(header)).toEqual({ filename: 'Grün Küche.mov' });
  });

  it('liefert für fehlende oder leere Header ein leeres Objekt', () => {
    expect(parseUploadMetadata(undefined)).toEqual({});
    expect(parseUploadMetadata('')).toEqual({});
    expect(parseUploadMetadata(' , , ')).toEqual({});
  });
});

describe('parseNonNegativeInteger', () => {
  it('nimmt nur reine Ziffernfolgen an', () => {
    expect(parseNonNegativeInteger('0')).toBe(0);
    expect(parseNonNegativeInteger(' 42 ')).toBe(42);
    expect(parseNonNegativeInteger('-1')).toBeNull();
    expect(parseNonNegativeInteger('1.5')).toBeNull();
    expect(parseNonNegativeInteger('1e3')).toBeNull();
    expect(parseNonNegativeInteger(undefined)).toBeNull();
    expect(parseNonNegativeInteger(['1', '2'])).toBeNull();
  });

  it('lehnt Werte jenseits der sicheren Ganzzahl ab', () => {
    expect(parseNonNegativeInteger('9007199254740993')).toBeNull();
  });
});

describe('checkOffset', () => {
  it('lässt den passenden Offset durch und meldet den Rest', () => {
    expect(checkOffset(0, 0, 100)).toEqual({ ok: true, remaining: 100 });
    expect(checkOffset(60, 60, 100)).toEqual({ ok: true, remaining: 40 });
  });

  it('weist abweichende Offsets ab', () => {
    expect(checkOffset(10, 20, 100)).toEqual({ ok: false, reason: 'offset-mismatch' });
    expect(checkOffset(30, 20, 100)).toEqual({ ok: false, reason: 'offset-mismatch' });
  });

  it('erkennt einen bereits vollständigen Upload', () => {
    expect(checkOffset(100, 100, 100)).toEqual({ ok: false, reason: 'already-complete' });
  });
});

describe('filenameFromMetadata', () => {
  it('findet den Dateinamen unter den üblichen Schlüsseln', () => {
    expect(filenameFromMetadata({ filename: 'a.mov' })).toBe('a.mov');
    expect(filenameFromMetadata({ name: 'b.mov' })).toBe('b.mov');
    expect(filenameFromMetadata({ fileName: 'c.mov' })).toBe('c.mov');
    expect(filenameFromMetadata({ filetype: 'video/mp4' })).toBeNull();
    expect(filenameFromMetadata({ filename: '   ' })).toBeNull();
  });
});
