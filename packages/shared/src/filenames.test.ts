import { describe, expect, it } from 'vitest';
import {
  buildDownloadFilename,
  extensionOf,
  fileDateFromIso,
  formatFileDate,
  sanitizeNamePart,
} from './filenames';

const basis = {
  date: '260728',
  customer: 'THD',
  projectName: 'Imagefilm 2026',
  videoName: 'Schnittfassung',
  versionNumber: 2,
  resolution: '2160p25',
  extension: 'mov',
};

describe('buildDownloadFilename', () => {
  it('folgt dem vereinbarten Schema', () => {
    expect(buildDownloadFilename(basis)).toBe('260728_THD_Imagefilm-2026_Schnittfassung_v2_2160p25.mov');
  });

  it('lässt fehlende Teile weg, statt Lücken zu hinterlassen', () => {
    expect(buildDownloadFilename({ ...basis, customer: null, date: null, resolution: null })).toBe(
      'Imagefilm-2026_Schnittfassung_v2.mov',
    );
  });

  it('macht aus Leerzeichen Bindestriche und hält den Unterstrich als Trenner frei', () => {
    expect(
      buildDownloadFilename({ ...basis, projectName: 'Neues  Projekt', videoName: 'Teil_2 Final' }),
    ).toBe('260728_THD_Neues-Projekt_Teil-2-Final_v2_2160p25.mov');
  });

  it('entschärft Pfad- und Sonderzeichen', () => {
    expect(
      buildDownloadFilename({ ...basis, customer: '../etc', videoName: 'a:b*c?"d<e>f|g' }),
    ).toBe('260728_etc_Imagefilm-2026_a-b-c-d-e-f-g_v2_2160p25.mov');
  });

  it('behält Umlaute', () => {
    expect(buildDownloadFilename({ ...basis, videoName: 'Grüße für Köln' })).toContain(
      'Grüße-für-Köln',
    );
  });

  it('ignoriert ein Datum in falschem Format', () => {
    expect(buildDownloadFilename({ ...basis, date: '2026-07-28' })).toBe(
      'THD_Imagefilm-2026_Schnittfassung_v2_2160p25.mov',
    );
  });

  it('kommt ohne Endung aus', () => {
    expect(buildDownloadFilename({ ...basis, extension: null })).toBe(
      '260728_THD_Imagefilm-2026_Schnittfassung_v2_2160p25',
    );
  });

  it('schreibt die Endung klein und entfernt Punkte davor', () => {
    expect(buildDownloadFilename({ ...basis, extension: '.MOV' })).toMatch(/\.mov$/);
  });

  it('fällt auf einen Ersatznamen zurück, wenn nichts übrig bleibt', () => {
    expect(
      buildDownloadFilename({
        date: null,
        customer: null,
        projectName: '...',
        videoName: '   ',
        versionNumber: 0,
        resolution: null,
        extension: 'mp4',
      }),
    ).toBe('v1.mp4');
  });
});

describe('sanitizeNamePart', () => {
  it('entfernt Steuerzeichen und begrenzt die Länge', () => {
    expect(sanitizeNamePart('a\u0000b\u001fc')).toBe('abc');
    expect(sanitizeNamePart('x'.repeat(200))).toHaveLength(60);
  });

  it('zieht mehrfache Trenner zusammen', () => {
    expect(sanitizeNamePart('a___b   c')).toBe('a-b-c');
  });
});

describe('formatFileDate / fileDateFromIso', () => {
  it('bildet JJMMTT', () => {
    expect(formatFileDate(new Date(2026, 6, 28))).toBe('260728');
    expect(formatFileDate(new Date(2005, 0, 3))).toBe('050103');
  });

  it('liest JJMMTT aus einem ISO-Datum', () => {
    expect(fileDateFromIso('2026-07-28')).toBe('260728');
    expect(fileDateFromIso('2026-07-28T14:33:00.000Z')).toBe('260728');
    expect(fileDateFromIso('unsinn')).toBeNull();
    expect(fileDateFromIso(null)).toBeNull();
  });
});

describe('extensionOf', () => {
  it('liefert die Endung klein', () => {
    expect(extensionOf('Clip.MOV')).toBe('mov');
    expect(extensionOf('a.b.mp4')).toBe('mp4');
  });

  it('gibt null zurück, wenn es keine gibt', () => {
    expect(extensionOf('ohne-endung')).toBeNull();
    expect(extensionOf('.versteckt')).toBeNull();
    expect(extensionOf('endet-mit-punkt.')).toBeNull();
    expect(extensionOf('seltsam.endung-mit-strich')).toBeNull();
  });
});

describe('buildDownloadFilename – Endfassung', () => {
  const basis = {
    date: '260304',
    customer: 'THD',
    projectName: 'Kampagne',
    videoName: 'Teaser',
    versionNumber: 1,
    resolution: '1080p25',
    extension: 'mov',
  };

  it('schreibt „Vorschau“ hinter die Nummer, solange die Fassung nicht final ist', () => {
    expect(buildDownloadFilename({ ...basis, isFinal: false })).toBe(
      '260304_THD_Kampagne_Teaser_v1_Vorschau_1080p25.mov',
    );
  });

  it('lässt den Namen bei einer Endfassung unverändert', () => {
    expect(buildDownloadFilename({ ...basis, isFinal: true })).toBe(
      '260304_THD_Kampagne_Teaser_v1_1080p25.mov',
    );
  });

  it('schweigt, wenn niemand nach der Endfassung fragt – alte Aufrufer bleiben gültig', () => {
    expect(buildDownloadFilename(basis)).toBe('260304_THD_Kampagne_Teaser_v1_1080p25.mov');
  });
});
