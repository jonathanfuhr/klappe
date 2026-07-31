import { type Locale, DEFAULT_LOCALE } from '@klappe/shared';
import { EXAKT, MUSTER } from './api-messages';

/**
 * Übersetzt eine API-Meldung (Phase 26).
 *
 * Deutsch ist die Quellsprache: Für `de` gibt es nichts zu tun, und was nicht
 * im Katalog steht, geht unverändert hinaus. Eine fehlende Übersetzung ist
 * damit ein Schönheitsfehler und kein Ausfall.
 */

/** Regulärer Ausdruck aus einem Muster: `{}` wird zur Fanggruppe. */
function zuAusdruck(muster: string): RegExp {
  const teile = muster.split('{}').map((teil) => teil.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Nicht gierig, damit bei mehreren Einsetzungen der Text dazwischen zählt;
  // die letzte darf alles bis zum Ende schlucken.
  return new RegExp(`^${teile.join('(.+?)')}$`, 's');
}

/** Einmal gebaut, danach nur noch geprüft – das läuft an jedem Fehler vorbei. */
const AUSDRUECKE = MUSTER.map((eintrag) => ({ ...eintrag, ausdruck: zuAusdruck(eintrag.de) }));

/** Setzt die gefundenen Werte der Reihe nach in die englische Vorlage ein. */
function fuellen(vorlage: string, werte: string[]): string {
  let index = 0;
  return vorlage.replace(/\{\}/g, () => werte[index++] ?? '');
}

export function translateMessage(text: string, locale: Locale): string {
  if (locale === DEFAULT_LOCALE) return text;

  const genau = EXAKT[text];
  if (genau) return genau;

  for (const eintrag of AUSDRUECKE) {
    const treffer = eintrag.ausdruck.exec(text);
    if (treffer) return fuellen(eintrag.en, treffer.slice(1));
  }

  return text;
}
