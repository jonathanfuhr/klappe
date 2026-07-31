import { describe, expect, it } from 'vitest';
import { EXAKT, MUSTER } from './api-messages';
import { translateMessage } from './translate';

describe('translateMessage', () => {
  it('lässt Deutsch unangetastet', () => {
    expect(translateMessage('Projekt nicht gefunden.', 'de')).toBe('Projekt nicht gefunden.');
  });

  it('schlägt einen bekannten Satz nach', () => {
    expect(translateMessage('Projekt nicht gefunden.', 'en')).toBe('Project not found.');
  });

  it('lässt Unbekanntes stehen, statt es zu verschlucken', () => {
    expect(translateMessage('Ein Satz, den niemand kennt.', 'en')).toBe(
      'Ein Satz, den niemand kennt.',
    );
  });

  it('setzt einen Wert aus dem Muster wieder ein', () => {
    expect(translateMessage('Das Schlagwort „Imagefilm" gibt es schon.', 'en')).toBe(
      'The tag “Imagefilm” already exists.',
    );
  });

  it('behält die Reihenfolge mehrerer Werte', () => {
    expect(translateMessage('Frame 900 liegt hinter dem Ende des Videos (750 Frames).', 'en')).toBe(
      'Frame 900 lies past the end of the video (750 frames).',
    );
  });

  it('nimmt auch einen Wert mit Sonderzeichen', () => {
    expect(translateMessage('Die Sicherung ist fehlgeschlagen: pg_dump: exit 1', 'en')).toBe(
      'The backup failed: pg_dump: exit 1',
    );
  });
});

describe('Katalog', () => {
  it('trägt beidseitig gleich viele Einsetzungen', () => {
    for (const eintrag of MUSTER) {
      const de = eintrag.de.split('{}').length - 1;
      const en = eintrag.en.split('{}').length - 1;
      expect(en, `Muster „${eintrag.de}"`).toBe(de);
    }
  });

  it('hat kein Muster ohne Einsetzung – das gehörte in die exakte Tabelle', () => {
    for (const eintrag of MUSTER) {
      expect(eintrag.de, `Muster „${eintrag.de}"`).toContain('{}');
    }
  });

  it('übersetzt keinen Satz in sich selbst', () => {
    for (const [de, en] of Object.entries(EXAKT)) {
      expect(en, `Eintrag „${de}"`).not.toBe(de);
    }
  });

  it('führt keinen Satz zugleich exakt und als Muster', () => {
    for (const eintrag of MUSTER) {
      expect(EXAKT[eintrag.de]).toBeUndefined();
    }
  });
});
