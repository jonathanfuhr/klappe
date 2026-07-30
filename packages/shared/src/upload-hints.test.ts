import { describe, expect, it } from 'vitest';
import { detectVersionNumber, matchProject, matchVideo, suggestVideoName } from './upload-hints';

describe('detectVersionNumber', () => {
  it('findet die üblichen Schreibweisen', () => {
    expect(detectVersionNumber('Imagefilm_V2.mov')).toBe(2);
    expect(detectVersionNumber('Imagefilm_v01.mp4')).toBe(1);
    expect(detectVersionNumber('Imagefilm V3 final.mov')).toBe(3);
    expect(detectVersionNumber('Imagefilm-v12.mxf')).toBe(12);
    expect(detectVersionNumber('Imagefilm_Version_4.mov')).toBe(4);
    expect(detectVersionNumber('V7_Schnittfassung.mov')).toBe(7);
  });

  it('nimmt bei mehreren Angaben die letzte', () => {
    expect(detectVersionNumber('Projekt_V1_Schnitt_V2.mov')).toBe(2);
  });

  it('lässt sich nicht von Wörtern mit v täuschen', () => {
    expect(detectVersionNumber('Advent2026.mov')).toBeNull();
    expect(detectVersionNumber('Interview 2.mov')).toBeNull();
    expect(detectVersionNumber('Silvester.mov')).toBeNull();
  });

  it('verwechselt Auflösungen nicht mit Versionen', () => {
    expect(detectVersionNumber('Clip_1080p25.mp4')).toBeNull();
    expect(detectVersionNumber('Clip_v1080p.mp4')).toBeNull();
  });

  it('gibt null zurück, wenn nichts drinsteht', () => {
    expect(detectVersionNumber('Schnittfassung.mov')).toBeNull();
    expect(detectVersionNumber('')).toBeNull();
  });
});

describe('suggestVideoName', () => {
  it('räumt Endung, Version und Trennzeichen weg', () => {
    expect(suggestVideoName('Beispiel_Imagefilm_V2.mov')).toBe('Beispiel Imagefilm');
    expect(suggestVideoName('kunde-projekt-v01.mp4')).toBe('kunde projekt');
  });

  it('entfernt Datumsblöcke', () => {
    expect(suggestVideoName('260728_Imagefilm_V2.mov')).toBe('Imagefilm');
    expect(suggestVideoName('20260728_Imagefilm.mov')).toBe('Imagefilm');
    expect(suggestVideoName('2026-07-28 Imagefilm.mov')).toBe('Imagefilm');
  });

  it('entfernt Format-Schnipsel', () => {
    expect(suggestVideoName('Imagefilm_1080p25_ProRes_final.mov')).toBe('Imagefilm');
    expect(suggestVideoName('Imagefilm_4K_UHD.mov')).toBe('Imagefilm');
  });

  it('gibt lieber den Rohnamen als gar nichts zurück', () => {
    expect(suggestVideoName('V2.mov')).toBe('V2');
    expect(suggestVideoName('final.mov')).toBe('final');
  });

  it('lässt Namen mit Punkten unangetastet', () => {
    expect(suggestVideoName('Teil 1.2 Schnitt.mov')).toBe('Teil 1 2 Schnitt');
  });
});

describe('matchProject', () => {
  const projekte = [
    { id: 'p1', name: 'Imagefilm 2026', customer: 'Beispiel' },
    { id: 'p2', name: 'Messefilm', customer: 'Bosch' },
    { id: 'p3', name: 'Recruiting Clips', customer: null },
  ];

  it('findet das Projekt über den Namen', () => {
    expect(matchProject('Imagefilm_V2.mov', projekte)?.projectId).toBe('p1');
    expect(matchProject('Messefilm-final.mp4', projekte)?.projectId).toBe('p2');
  });

  it('gewichtet den Kunden stärker als den Projektnamen', () => {
    // „Bosch“ ist der Kunde von p2 – das sticht das Namenswort „Clips“.
    const treffer = matchProject('Bosch_Clips_V1.mov', projekte);
    expect(treffer?.projectId).toBe('p2');
  });

  it('nennt die passenden Wörter für den Hinweis', () => {
    expect(matchProject('Beispiel_Imagefilm_V2.mov', projekte)?.matched.sort()).toEqual([
      'beispiel',
      'imagefilm',
    ]);
  });

  it('gibt null zurück, wenn nichts passt', () => {
    expect(matchProject('DJI_0001.MOV', projekte)).toBeNull();
    expect(matchProject('Imagefilm.mov', [])).toBeNull();
  });

  it('ignoriert sehr kurze Wörter', () => {
    expect(matchProject('an_de_zu.mov', projekte)).toBeNull();
  });
});

describe('matchVideo', () => {
  const videos = [
    { id: 'v1', name: 'Schnittfassung' },
    { id: 'v2', name: 'Teaser 30 Sekunden' },
  ];

  it('erkennt eine neue Fassung eines vorhandenen Videos', () => {
    expect(matchVideo('Imagefilm_Schnittfassung_V3.mov', videos)).toBe('v1');
  });

  it('verlangt genug Übereinstimmung', () => {
    // „Sekunden“ allein reicht bei einem dreiwortigen Videonamen nicht.
    expect(matchVideo('Sekunden.mov', videos)).toBeNull();
    expect(matchVideo('Teaser 30.mov', videos)).toBe('v2');
  });

  it('gibt null zurück, wenn es keine Videos gibt', () => {
    expect(matchVideo('Schnittfassung.mov', [])).toBeNull();
  });
});
