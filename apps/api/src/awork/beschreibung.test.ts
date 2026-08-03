import { describe, expect, it } from 'vitest';
import {
  type AworkKommentar,
  baueAenderungsHinweis,
  baueAufgabenTitel,
  baueBeschreibung,
  sortiereKommentare,
} from './beschreibung';

const kommentar = (overrides: Partial<AworkKommentar> = {}): AworkKommentar => ({
  timecode: '00:00:10:00',
  frame: 250,
  autor: 'Anna Beispiel',
  text: 'Bitte den Schnitt straffen.',
  erledigt: false,
  hatZeichnung: false,
  antworten: [],
  ...overrides,
});

describe('sortiereKommentare', () => {
  it('stellt Anmerkungen ohne Zeitbezug nach vorn', () => {
    const sortiert = sortiereKommentare([
      kommentar({ frame: 500, text: 'spät' }),
      kommentar({ frame: null, timecode: null, text: 'allgemein' }),
      kommentar({ frame: 100, text: 'früh' }),
    ]);
    expect(sortiert.map((eintrag) => eintrag.text)).toEqual(['allgemein', 'früh', 'spät']);
  });

  it('lässt die Vorlage unangetastet', () => {
    const original = [kommentar({ frame: 500 }), kommentar({ frame: 100 })];
    sortiereKommentare(original);
    expect(original[0].frame).toBe(500);
  });
});

describe('baueBeschreibung', () => {
  const basis = {
    url: 'https://klappe.example.de/videos/abc?fassung=2',
    videoName: 'Imagefilm',
    versionLabel: 'v2',
  };

  it('nennt Timecode, Verfasser und Text', () => {
    const html = baueBeschreibung({ ...basis, kommentare: [kommentar()] });
    expect(html).toContain('00:00:10:00');
    expect(html).toContain('Anna Beispiel');
    expect(html).toContain('Bitte den Schnitt straffen.');
  });

  it('verlinkt die Fassung in Klappe', () => {
    const html = baueBeschreibung({ ...basis, kommentare: [] });
    expect(html).toContain('href="https://klappe.example.de/videos/abc?fassung=2"');
    expect(html).toContain('Imagefilm · v2');
  });

  it('sagt oben, dass Klappe die Beschreibung pflegt', () => {
    // Ohne diesen Hinweis schreibt jemand in awork hinein, und es ist beim
    // nächsten Kommentar weg.
    const html = baueBeschreibung({ ...basis, kommentare: [] });
    expect(html).toContain('pflegt Klappe');
  });

  it('zählt offene Anmerkungen', () => {
    const html = baueBeschreibung({
      ...basis,
      kommentare: [kommentar(), kommentar({ erledigt: true }), kommentar()],
    });
    expect(html).toContain('<strong>3 Anmerkungen</strong>, davon 2 offen.');
  });

  it('hakt Erledigtes ab', () => {
    const html = baueBeschreibung({ ...basis, kommentare: [kommentar({ erledigt: true })] });
    expect(html).toContain('✓');
  });

  it('vermerkt eine Zeichnung', () => {
    const html = baueBeschreibung({ ...basis, kommentare: [kommentar({ hatZeichnung: true })] });
    expect(html).toContain('✏️');
  });

  it('hängt Antworten unter den Kommentar', () => {
    const html = baueBeschreibung({
      ...basis,
      kommentare: [
        kommentar({ antworten: [{ autor: 'Ben Beispiel', text: 'Ist geändert.' }] }),
      ],
    });
    expect(html).toContain('Ben Beispiel');
    expect(html).toContain('Ist geändert.');
  });

  it('maskiert HTML aus dem Kommentartext', () => {
    // Sonst zerlegt ein Kommentar mit spitzen Klammern die ganze Beschreibung.
    const html = baueBeschreibung({
      ...basis,
      kommentare: [kommentar({ text: '<script>alert("hi")</script> & mehr' })],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; mehr');
  });

  it('kommt ohne Kommentare aus', () => {
    const html = baueBeschreibung({ ...basis, kommentare: [] });
    expect(html).toContain('keine offenen Anmerkungen');
  });

  it('lässt den Timecode weg, wo es keinen gibt', () => {
    const html = baueBeschreibung({
      ...basis,
      kommentare: [kommentar({ frame: null, timecode: null, text: 'Ton ist zu leise.' })],
    });
    expect(html).toContain('Ton ist zu leise.');
    expect(html).not.toContain('00:00:10:00');
  });
});

describe('baueAufgabenTitel', () => {
  it('setzt Praefix, Video und Fassung zusammen', () => {
    expect(
      baueAufgabenTitel({
        prefix: 'Korrektur: ',
        videoName: 'Imagefilm',
        versionLabel: 'v2',
        round: 1,
      }),
    ).toBe('Korrektur: Imagefilm · v2');
  });

  it('nennt die Runde erst ab der zweiten', () => {
    expect(
      baueAufgabenTitel({
        prefix: 'Korrektur: ',
        videoName: 'Imagefilm',
        versionLabel: 'v2',
        round: 2,
      }),
    ).toBe('Korrektur: Imagefilm · v2 · Runde 2');
  });
});

describe('baueAenderungsHinweis', () => {
  it('zaehlt im Singular und im Plural richtig', () => {
    expect(baueAenderungsHinweis(1, 'https://example.de')).toContain('1 neue Anmerkung');
    expect(baueAenderungsHinweis(3, 'https://example.de')).toContain('3 neue Anmerkungen');
  });
});
