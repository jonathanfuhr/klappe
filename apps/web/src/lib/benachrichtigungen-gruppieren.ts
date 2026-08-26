import type { NotificationDto } from '@klappe/shared';

/**
 * Benachrichtigungen nach Projekt bündeln (1.7.14).
 *
 * Vorher stand in der Zentrale jeder einzelne Kommentar für sich. Bei einer
 * Abnahmerunde sind das schnell zwanzig Zeilen zu **einem** Film, und wer
 * daneben noch an zwei anderen Projekten sitzt, findet sie nicht mehr
 * wieder – die Liste sagt dann nur noch „viel", nicht mehr „was".
 *
 * Gruppiert wird nach der Projekt-Kennung, nicht nach dem Namen: Zwei
 * Projekte dürfen gleich heißen.
 *
 * Reine Rechnerei, damit sich die Reihenfolge prüfen lässt – die ist der
 * heikle Teil. Neu muss oben stehen, sonst sucht man das Frische unter dem
 * Alten.
 */

export interface Projektgruppe {
  projectId: string;
  projectName: string;
  eintraege: NotificationDto[];
  /** Wie viele davon noch ungelesen sind – die Zahl steht am Kopf. */
  ungelesen: number;
  /** Ist eine Erwähnung dabei? Die hebt die Gruppe hervor. */
  erwaehnung: boolean;
  /** Zeitpunkt des jüngsten Eintrags, für Sortierung und Anzeige. */
  neuestesAm: string;
  /** Wie viele verschiedene Filme betroffen sind. */
  videoAnzahl: number;
}

/**
 * So viele Einträge stehen offen da, der Rest klappt auf Wunsch auf.
 *
 * Drei, weil eine Gruppe mit zwei Einträgen keine Faltung braucht – die zu
 * verstecken wäre ein Klick für nichts.
 */
export const SICHTBAR_JE_GRUPPE = 3;

export function gruppiereNachProjekt(eintraege: NotificationDto[]): Projektgruppe[] {
  const gruppen = new Map<string, Projektgruppe>();

  for (const eintrag of eintraege) {
    let gruppe = gruppen.get(eintrag.projectId);
    if (!gruppe) {
      gruppe = {
        projectId: eintrag.projectId,
        projectName: eintrag.projectName,
        eintraege: [],
        ungelesen: 0,
        erwaehnung: false,
        neuestesAm: eintrag.createdAt,
        videoAnzahl: 0,
      };
      gruppen.set(eintrag.projectId, gruppe);
    }

    gruppe.eintraege.push(eintrag);
    if (eintrag.readAt === null) gruppe.ungelesen += 1;
    if (eintrag.mentioned) gruppe.erwaehnung = true;
    if (eintrag.createdAt > gruppe.neuestesAm) gruppe.neuestesAm = eintrag.createdAt;
  }

  for (const gruppe of gruppen.values()) {
    // Innerhalb der Gruppe das Jüngste zuerst. Die Liste kommt zwar schon so
    // vom Server, aber die Gruppe soll nicht davon abhängen, dass das so
    // bleibt.
    gruppe.eintraege.sort((links, rechts) => rechts.createdAt.localeCompare(links.createdAt));
    gruppe.videoAnzahl = new Set(gruppe.eintraege.map((eintrag) => eintrag.videoId)).size;
  }

  /*
   * Erwähnungen zuerst, dann nach Zeit.
   *
   * Wer namentlich angesprochen wurde, soll das nicht unter drei Projekten
   * mit gewöhnlichen Kommentaren suchen müssen – das ist der eine Fall, in
   * dem jemand wirklich gemeint ist.
   */
  return [...gruppen.values()].sort((links, rechts) => {
    if (links.erwaehnung !== rechts.erwaehnung) return links.erwaehnung ? -1 : 1;
    return rechts.neuestesAm.localeCompare(links.neuestesAm);
  });
}
