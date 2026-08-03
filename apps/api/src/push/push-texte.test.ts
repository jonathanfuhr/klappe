import { describe, expect, it } from 'vitest';
import { renderCommentPush } from './push-texte';

/**
 * Was auf dem Sperrbildschirm steht, ist eine Entscheidung und keine
 * Formatierung – deshalb geprüft. Vor allem die beiden Fälle, in denen die
 * Kachel sonst still Unsinn zeigte: ein Projekt ohne hinterlegten Kunden und
 * die Zählung bei genau einer Meldung.
 */
describe('renderCommentPush', () => {
  const basis = {
    customer: 'Musterfirma',
    projectName: 'Relaunch 2026',
    videoName: 'Imagefilm',
  };

  it('nennt Kunde, Projekt und Video in dieser Reihenfolge', () => {
    const { title, body } = renderCommentPush({ ...basis, mentioned: false, unread: 1 });
    expect(title).toBe('Neuer Kommentar');
    expect(body).toBe('Musterfirma · Relaunch 2026 · Imagefilm');
  });

  it('lässt den Kunden weg, wenn keiner hinterlegt ist', () => {
    const { body } = renderCommentPush({ ...basis, customer: null, mentioned: false, unread: 1 });
    expect(body).toBe('Relaunch 2026 · Imagefilm');
  });

  it('behandelt einen Kunden aus Leerzeichen wie keinen', () => {
    const { body } = renderCommentPush({ ...basis, customer: '   ', mentioned: false, unread: 1 });
    expect(body).toBe('Relaunch 2026 · Imagefilm');
  });

  it('zählt erst ab der zweiten ungelesenen Meldung', () => {
    // Kein `not.toMatch(/\d/)` – ein Projektname darf selbst Ziffern tragen
    // („Relaunch 2026"). Geprüft wird, dass gar kein Zähler davorsteht.
    const eine = renderCommentPush({ ...basis, mentioned: false, unread: 1 });
    expect(eine.body).toBe('Musterfirma · Relaunch 2026 · Imagefilm');

    const drei = renderCommentPush({ ...basis, mentioned: false, unread: 3 });
    expect(drei.body).toBe('3 neue Kommentare · Musterfirma · Relaunch 2026 · Imagefilm');
  });

  it('hebt eine Erwähnung in der Überschrift hervor, zählt aber weiter', () => {
    const { title, body } = renderCommentPush({ ...basis, mentioned: true, unread: 4 });
    expect(title).toBe('Du wurdest erwähnt');
    expect(body).toContain('4 neue Kommentare');
  });

  it('spricht Englisch, wenn der Empfänger es so eingestellt hat', () => {
    const { title, body } = renderCommentPush({
      ...basis,
      locale: 'en',
      mentioned: false,
      unread: 2,
    });
    expect(title).toBe('New comment');
    expect(body).toBe('2 new comments · Musterfirma · Relaunch 2026 · Imagefilm');
  });
});
