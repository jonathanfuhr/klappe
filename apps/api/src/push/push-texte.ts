/**
 * Die Worte auf dem Sperrbildschirm (Phase 29).
 *
 * Reine Funktionen wie bei den Mailvorlagen – und aus demselben Grund von der
 * Zustellung getrennt: Dieselbe Meldung geht an mehrere Menschen mit womöglich
 * verschiedener Sprachwahl. Die Sprache muss beim Aufruf feststehen und kann
 * nicht aus einem Kontext kommen.
 *
 * Kurz gehalten, mit Absicht. Was hier steht, ist auf einem Gerät lesbar, das
 * gerade auf einem Tisch liegt – also die Einordnung und sonst nichts: kein
 * Autorenname, kein Kommentartext.
 */
import { type Locale, DEFAULT_LOCALE } from '@klappe/shared';

interface PushTexte {
  neuerKommentar: string;
  neueErwaehnung: string;
  mehrere: (anzahl: number) => string;
}

const TEXTE: Record<Locale, PushTexte> = {
  de: {
    neuerKommentar: 'Neuer Kommentar',
    neueErwaehnung: 'Du wurdest erwähnt',
    mehrere: (anzahl) => `${anzahl} neue Kommentare`,
  },
  en: {
    neuerKommentar: 'New comment',
    neueErwaehnung: 'You were mentioned',
    mehrere: (anzahl) => `${anzahl} new comments`,
  },
};

export interface PushTextEingang {
  locale?: Locale;
  /** Namentlich angesprochen? Ändert nur die Überschrift, nicht die Zählung. */
  mentioned: boolean;
  /**
   * Wie viel zu diesem Video insgesamt ungelesen ist – **einschliesslich**
   * dieser Meldung. 1 heisst also: nur diese eine.
   */
  unread: number;
  customer: string | null;
  projectName: string;
  videoName: string;
}

export function renderCommentPush(eingang: PushTextEingang): { title: string; body: string } {
  const texte = TEXTE[eingang.locale ?? DEFAULT_LOCALE] ?? TEXTE[DEFAULT_LOCALE];
  const title = eingang.mentioned ? texte.neueErwaehnung : texte.neuerKommentar;

  /*
   * Kunde · Projekt · Video – von der grossen Klammer zur kleinen. Ein Video
   * heisst manchmal nur „Imagefilm"; ohne die beiden davor sagt die Kachel
   * nichts. Ohne hinterlegten Kunden fällt der Teil weg statt eine leere
   * Stelle zu hinterlassen.
   */
  const wo = [eingang.customer, eingang.projectName, eingang.videoName]
    .map((teil) => teil?.trim())
    .filter((teil): teil is string => Boolean(teil))
    .join(' · ');

  // Die Zahl nur, wenn wirklich mehr wartet: „1 neuer Kommentar" wäre eine
  // Zählung ohne Anlass.
  const body = eingang.unread > 1 ? `${texte.mehrere(eingang.unread)} · ${wo}` : wo;
  return { title, body };
}
