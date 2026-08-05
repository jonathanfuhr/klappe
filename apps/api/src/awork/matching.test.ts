import { describe, expect, it } from 'vitest';
import {
  type AworkKandidat,
  ausschlussGrund,
  findeProjekt,
  freifeldWert,
  kundenPassen,
  normalisiereKunde,
  normalisiereProjektKey,
  normalisiereProjektnummer,
  parseAusschluss,
  parseProjektTypen,
  typErlaubt,
} from './matching';

const projekt = (
  id: string,
  projectKey: string | null,
  companyName: string | null = null,
): AworkKandidat => ({
  id,
  name: `Projekt ${id}`,
  companyName,
  projectKey,
  projectNumber: null,
});

describe('normalisiereProjektnummer', () => {
  it('vereinheitlicht Schreibweise und Trenner', () => {
    expect(normalisiereProjektnummer('j26q3p0153')).toBe('J26Q3P0153');
    expect(normalisiereProjektnummer(' J26 Q3-P0153 ')).toBe('J26Q3P0153');
    expect(normalisiereProjektnummer('J26/Q3.P0153')).toBe('J26Q3P0153');
  });

  it('macht aus fehlenden Werten eine leere Zeichenkette', () => {
    expect(normalisiereProjektnummer(null)).toBe('');
    expect(normalisiereProjektnummer(undefined)).toBe('');
    expect(normalisiereProjektnummer('   ')).toBe('');
  });
});

describe('normalisiereKunde', () => {
  it('fasst Leerzeichen zusammen und schreibt klein', () => {
    expect(normalisiereKunde('  Beispiel   GmbH ')).toBe('beispiel gmbh');
  });

  it('lässt Umlaute stehen', () => {
    // Absicht: „Müller" und „Mueller" gelten als verschieden, siehe matching.ts.
    expect(normalisiereKunde('Müller')).toBe('müller');
    expect(normalisiereKunde('Müller')).not.toBe(normalisiereKunde('Mueller'));
  });
});

describe('kundenPassen', () => {
  it('erkennt dieselbe Firma trotz anderer Schreibweise', () => {
    expect(kundenPassen('Beispiel GmbH', 'beispiel  gmbh')).toBe(true);
  });

  it('schweigt, wenn eine Seite nichts hinterlegt hat', () => {
    expect(kundenPassen(null, 'Beispiel GmbH')).toBe(true);
    expect(kundenPassen('Beispiel GmbH', '')).toBe(true);
    expect(kundenPassen(null, null)).toBe(true);
  });

  it('widerspricht bei zwei verschiedenen Firmen', () => {
    expect(kundenPassen('Beispiel GmbH', 'Andere AG')).toBe(false);
  });
});

describe('findeProjekt', () => {
  const kandidaten = [
    projekt('a', 'UBEI', 'Beispiel GmbH'),
    projekt('b', 'ENSS', 'Andere AG'),
    projekt('c', null, 'Ohne Key KG'),
  ];

  it('findet über den Projekt-Key, Schreibweise egal', () => {
    const ergebnis = findeProjekt('ubei', 'Beispiel GmbH', kandidaten);
    expect(ergebnis.art).toBe('treffer');
    if (ergebnis.art === 'treffer') expect(ergebnis.kandidat.id).toBe('a');
  });

  it('nimmt einen Treffer auch ohne Kundenangabe an', () => {
    expect(findeProjekt('UBEI', null, kandidaten).art).toBe('treffer');
  });

  it('meldet einen abweichenden Kunden, statt still zuzuordnen', () => {
    const ergebnis = findeProjekt('UBEI', 'Ganz Anders GmbH', kandidaten);
    expect(ergebnis.art).toBe('kunde-abweichend');
    if (ergebnis.art === 'kunde-abweichend') {
      expect(ergebnis.kandidat.id).toBe('a');
      expect(ergebnis.gefunden).toBe('Beispiel GmbH');
    }
  });

  it('meldet Mehrdeutigkeit, wenn zwei Projekte denselben Key tragen', () => {
    // In awork kommt das nicht vor; von Hand abgetippt schon.
    const doppelt = [...kandidaten, projekt('d', 'UBEI', 'Beispiel GmbH')];
    const ergebnis = findeProjekt('UBEI', 'Beispiel GmbH', doppelt);
    expect(ergebnis.art).toBe('mehrdeutig');
    if (ergebnis.art === 'mehrdeutig') expect(ergebnis.kandidaten).toHaveLength(2);
  });

  it('unterscheidet „kein Key am Projekt" von „nichts gefunden"', () => {
    expect(findeProjekt('', 'Beispiel GmbH', kandidaten).art).toBe('ohne-key');
    expect(findeProjekt('XXXX', 'Beispiel GmbH', kandidaten).art).toBe('kein-treffer');
  });

  it('ordnet Projekte ohne Key in awork niemandem zu', () => {
    expect(findeProjekt(null, 'Ohne Key KG', kandidaten).art).toBe('ohne-key');
  });
});

describe('normalisiereProjektKey', () => {
  it('vereinheitlicht Schreibweise und Leerraum', () => {
    expect(normalisiereProjektKey('ubei')).toBe('UBEI');
    expect(normalisiereProjektKey(' UB EI ')).toBe('UBEI');
  });

  it('behält Bindestriche – anders als bei der Projektnummer', () => {
    // Der Key kommt aus awork und wird nicht getippt; ein Bindestrich darin
    // wäre Teil des Keys, kein Trennzeichen.
    expect(normalisiereProjektKey('AB-CD')).toBe('AB-CD');
  });

  it('macht aus fehlenden Werten eine leere Zeichenkette', () => {
    expect(normalisiereProjektKey(null)).toBe('');
    expect(normalisiereProjektKey('   ')).toBe('');
  });
});

describe('parseProjektTypen', () => {
  it('zerlegt die Kommaliste und wirft Doppeltes weg', () => {
    expect(parseProjektTypen('a, b ,a')).toEqual(['a', 'b']);
  });

  it('macht aus nichts eine leere Liste', () => {
    expect(parseProjektTypen(null)).toEqual([]);
    expect(parseProjektTypen('  ')).toEqual([]);
  });
});

describe('typErlaubt', () => {
  it('lässt ohne Auswahl alles durch', () => {
    expect(typErlaubt('a', [])).toBe(true);
    expect(typErlaubt(null, [])).toBe(true);
  });

  it('lässt nur die gewählten Typen durch', () => {
    expect(typErlaubt('a', ['a', 'b'])).toBe(true);
    expect(typErlaubt('c', ['a', 'b'])).toBe(false);
  });

  it('schliesst Projekte ohne Typ aus, sobald eingeschränkt wurde', () => {
    // Sonst käme ausgerechnet das Unsortierte durch, das niemand gewählt hat.
    expect(typErlaubt(null, ['a'])).toBe(false);
  });
});

describe('parseAusschluss', () => {
  it('trennt an Zeilen, Kommas und Semikolons', () => {
    expect(parseAusschluss('Beispiel GmbH\nIntern, Muster; Test')).toEqual([
      'beispiel gmbh',
      'intern',
      'muster',
      'test',
    ]);
  });

  it('wirft Leeres und Doppeltes weg', () => {
    expect(parseAusschluss('  Intern , ,\n\nintern  ')).toEqual(['intern']);
  });

  it('kommt mit fehlender Angabe zurecht', () => {
    expect(parseAusschluss(null)).toEqual([]);
    expect(parseAusschluss('   ')).toEqual([]);
  });
});

describe('ausschlussGrund', () => {
  const begriffe = ['beispiel gmbh', 'intern'];

  it('erkennt den Kunden', () => {
    expect(
      ausschlussGrund({ name: 'Imagefilm', companyName: 'Beispiel GmbH' }, begriffe),
    ).toBe('beispiel gmbh');
  });

  it('erkennt den Projektnamen, auch als Teil davon', () => {
    // „wer genauer zielen will, schreibt mehr hin" – siehe matching.ts
    expect(ausschlussGrund({ name: 'Interne Schulung 2026' }, begriffe)).toBe('intern');
  });

  it('erkennt die Projektnummer', () => {
    expect(ausschlussGrund({ name: 'Film', projectNumber: 'INTERN-2026' }, begriffe)).toBe(
      'intern',
    );
  });

  it('achtet nicht auf Gross- und Kleinschreibung', () => {
    expect(ausschlussGrund({ companyName: 'BEISPIEL GMBH' }, begriffe)).toBe('beispiel gmbh');
  });

  it('laesst durch, was keinen Begriff traegt', () => {
    expect(
      ausschlussGrund({ name: 'Imagefilm', companyName: 'Andere AG' }, begriffe),
    ).toBeNull();
  });

  it('laesst ohne Begriffe alles durch', () => {
    expect(ausschlussGrund({ name: 'Intern', companyName: 'Beispiel GmbH' }, [])).toBeNull();
  });

  it('kommt mit leeren Feldern zurecht', () => {
    expect(ausschlussGrund({ name: null, companyName: null, projectNumber: null }, begriffe))
      .toBeNull();
  });
});

describe('freifeldWert', () => {
  const felder = [
    { customFieldDefinitionId: 'nummer', textValue: 'J26Q3P0153' },
    { customFieldDefinitionId: 'laufzeit', textValue: '  ' },
  ];

  it('liest den Wert der passenden Definition', () => {
    expect(freifeldWert(felder, 'nummer')).toBe('J26Q3P0153');
  });

  it('behandelt Leerraum wie einen fehlenden Wert', () => {
    expect(freifeldWert(felder, 'laufzeit')).toBeNull();
  });

  it('kommt mit fehlenden Angaben zurecht', () => {
    expect(freifeldWert(felder, null)).toBeNull();
    expect(freifeldWert(null, 'nummer')).toBeNull();
    expect(freifeldWert(felder, 'gibtesnicht')).toBeNull();
  });
});
