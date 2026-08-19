/**
 * Auftragskennungen für BullMQ.
 *
 * Reine Rechnerei in einer eigenen Datei, damit sich die eine Regel prüfen
 * lässt, an der alles hängt: **kein Doppelpunkt.**
 *
 * BullMQ weist eine benutzerdefinierte Kennung mit `:` rundheraus ab – der
 * Doppelpunkt trennt dort die eigenen Schlüssel in Redis. Bis 1.7.13 hießen
 * die awork-Aufträge `korrekturen:<Fassung>`, kamen deshalb **nie** in die
 * Warteschlange, und weil der einreihende Dienst bewusst nie wirft, fiel es
 * nirgends auf: Der Kommentar war gespeichert, die Aufgabe in awork entstand
 * einfach nicht. Im Protokoll stand eine Zeile, die niemand las.
 *
 * Deshalb an einer Stelle, und deshalb werden Doppelpunkte in den Teilen
 * ausdrücklich ersetzt statt nur nicht gesetzt: Eine Kennung entsteht aus
 * Werten, die von woanders kommen – ein Verbot, das nur in einem Kommentar
 * steht, hält keinem Nachtrag stand.
 */
export function aworkJobKennung(...teile: string[]): string {
  return teile.map((teil) => teil.replaceAll(':', '-')).join('-');
}
