import type { NotificationDto } from '@klappe/shared';
import { describe, expect, it } from 'vitest';
import { gruppiereNachProjekt } from './benachrichtigungen-gruppieren';

const eintrag = (overrides: Partial<NotificationDto> = {}): NotificationDto => ({
  id: Math.random().toString(36).slice(2),
  mentioned: false,
  createdAt: '2026-08-19T10:00:00.000Z',
  readAt: null,
  authorName: 'Anna Beispiel',
  projectId: 'projekt-a',
  projectName: 'Beispiel Imagefilm',
  videoId: 'video-1',
  videoName: 'Schnittfassung',
  versionLabel: 'v2',
  timecode: '00:00:10:00',
  excerpt: 'Hier bitte kürzen.',
  isReply: false,
  ...overrides,
});

describe('gruppiereNachProjekt', () => {
  it('fasst die Einträge eines Projekts zu einer Gruppe zusammen', () => {
    const gruppen = gruppiereNachProjekt([eintrag(), eintrag(), eintrag()]);
    expect(gruppen).toHaveLength(1);
    expect(gruppen[0].eintraege).toHaveLength(3);
    expect(gruppen[0].projectName).toBe('Beispiel Imagefilm');
  });

  it('trennt nach Kennung, nicht nach Namen', () => {
    // Zwei Projekte dürfen gleich heißen – dann gehören sie trotzdem nicht
    // in denselben Topf.
    const gruppen = gruppiereNachProjekt([
      eintrag({ projectId: 'a', projectName: 'Imagefilm' }),
      eintrag({ projectId: 'b', projectName: 'Imagefilm' }),
    ]);
    expect(gruppen).toHaveLength(2);
  });

  it('zählt Ungelesene und betroffene Filme', () => {
    const [gruppe] = gruppiereNachProjekt([
      eintrag({ videoId: 'v1', readAt: null }),
      eintrag({ videoId: 'v1', readAt: '2026-08-19T11:00:00.000Z' }),
      eintrag({ videoId: 'v2', readAt: null }),
    ]);
    expect(gruppe.eintraege).toHaveLength(3);
    expect(gruppe.ungelesen).toBe(2);
    expect(gruppe.videoAnzahl).toBe(2);
  });

  it('stellt das Jüngste innerhalb der Gruppe nach oben', () => {
    const [gruppe] = gruppiereNachProjekt([
      eintrag({ excerpt: 'alt', createdAt: '2026-08-19T08:00:00.000Z' }),
      eintrag({ excerpt: 'neu', createdAt: '2026-08-19T12:00:00.000Z' }),
      eintrag({ excerpt: 'mittel', createdAt: '2026-08-19T10:00:00.000Z' }),
    ]);
    expect(gruppe.eintraege.map((e) => e.excerpt)).toEqual(['neu', 'mittel', 'alt']);
    expect(gruppe.neuestesAm).toBe('2026-08-19T12:00:00.000Z');
  });

  it('sortiert Gruppen nach dem jüngsten Eintrag', () => {
    const gruppen = gruppiereNachProjekt([
      eintrag({ projectId: 'alt', createdAt: '2026-08-19T08:00:00.000Z' }),
      eintrag({ projectId: 'neu', createdAt: '2026-08-19T12:00:00.000Z' }),
    ]);
    expect(gruppen.map((g) => g.projectId)).toEqual(['neu', 'alt']);
  });

  it('zieht eine Erwähnung nach ganz oben, auch wenn sie älter ist', () => {
    // Wer namentlich angesprochen wurde, soll das nicht unter Projekten mit
    // gewöhnlichen Kommentaren suchen müssen.
    const gruppen = gruppiereNachProjekt([
      eintrag({ projectId: 'neu', createdAt: '2026-08-19T12:00:00.000Z' }),
      eintrag({ projectId: 'erwaehnt', createdAt: '2026-08-19T08:00:00.000Z', mentioned: true }),
    ]);
    expect(gruppen.map((g) => g.projectId)).toEqual(['erwaehnt', 'neu']);
    expect(gruppen[0].erwaehnung).toBe(true);
  });

  it('kommt mit einer leeren Liste zurecht', () => {
    expect(gruppiereNachProjekt([])).toEqual([]);
  });
});
