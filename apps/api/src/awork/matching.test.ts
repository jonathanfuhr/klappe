import { describe, expect, it } from 'vitest';
import {
  type AworkKandidat,
  findeProjekt,
  freifeldWert,
  kundenPassen,
  normalisiereKunde,
  normalisiereProjektnummer,
} from './matching';

const projekt = (
  id: string,
  projectNumber: string | null,
  companyName: string | null = null,
): AworkKandidat => ({ id, name: `Projekt ${id}`, companyName, projectNumber });

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
    projekt('a', 'J26Q3P0153', 'Beispiel GmbH'),
    projekt('b', 'J26Q3P0152', 'Andere AG'),
    projekt('c', null, 'Ohne Nummer KG'),
  ];

  it('findet über die Projektnummer, Schreibweise egal', () => {
    const ergebnis = findeProjekt('j26 q3 p0153', 'Beispiel GmbH', kandidaten);
    expect(ergebnis.art).toBe('treffer');
    if (ergebnis.art === 'treffer') expect(ergebnis.kandidat.id).toBe('a');
  });

  it('nimmt einen Treffer auch ohne Kundenangabe an', () => {
    expect(findeProjekt('J26Q3P0153', null, kandidaten).art).toBe('treffer');
  });

  it('meldet einen abweichenden Kunden, statt still zuzuordnen', () => {
    const ergebnis = findeProjekt('J26Q3P0153', 'Ganz Anders GmbH', kandidaten);
    expect(ergebnis.art).toBe('kunde-abweichend');
    if (ergebnis.art === 'kunde-abweichend') {
      expect(ergebnis.kandidat.id).toBe('a');
      expect(ergebnis.gefunden).toBe('Beispiel GmbH');
    }
  });

  it('meldet Mehrdeutigkeit, wenn zwei Projekte dieselbe Nummer tragen', () => {
    const doppelt = [...kandidaten, projekt('d', 'J26Q3P0153', 'Beispiel GmbH')];
    const ergebnis = findeProjekt('J26Q3P0153', 'Beispiel GmbH', doppelt);
    expect(ergebnis.art).toBe('mehrdeutig');
    if (ergebnis.art === 'mehrdeutig') expect(ergebnis.kandidaten).toHaveLength(2);
  });

  it('unterscheidet „keine Nummer am Projekt" von „nichts gefunden"', () => {
    expect(findeProjekt('', 'Beispiel GmbH', kandidaten).art).toBe('ohne-nummer');
    expect(findeProjekt('J99X9P9999', 'Beispiel GmbH', kandidaten).art).toBe('kein-treffer');
  });

  it('ordnet Projekte ohne Nummer in awork niemandem zu', () => {
    // Sonst würden alle nummernlosen Projekte auf beiden Seiten zusammenfallen.
    expect(findeProjekt(null, 'Ohne Nummer KG', kandidaten).art).toBe('ohne-nummer');
  });

  it('behandelt einen blossen Strich wie eine fehlende Nummer', () => {
    /*
     * Aufgefallen beim ersten Lauf gegen den echten Workspace: In zwei
     * awork-Projekten stand „-" im Feld – ausgefüllt, aber ohne Aussage.
     * Roh betrachtet galt das als Nummer, und beide landeten als neue
     * Projekte in Klappe.
     */
    for (const platzhalter of ['-', '--', '.', '/', ' - ', '___']) {
      expect(normalisiereProjektnummer(platzhalter)).toBe('');
      expect(findeProjekt(platzhalter, null, kandidaten).art).toBe('ohne-nummer');
    }
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
