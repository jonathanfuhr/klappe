/**
 * Versionsnummern.
 *
 * Anfangs waren das ganze Zahlen. Beim Arbeiten zeigte sich, dass zwischen v2
 * und v3 oft noch eine kleine Korrekturfassung liegt – die soll v2.5 heißen
 * dürfen und nicht v3, weil v3 schon der nächste große Wurf ist. Deshalb sind
 * Nachkommastellen erlaubt.
 *
 * Zwei Regeln bleiben: In einem Video gibt es jede Nummer nur einmal, und eine
 * neue Fassung trägt immer eine höhere Nummer als die bisher höchste. Ohne die
 * zweite Regel stünde die Liste irgendwann in beliebiger Reihenfolge da.
 */

/** Drei Nachkommastellen – mehr trägt die Spalte in der Datenbank nicht. */
export const VERSION_NUMBER_DECIMALS = 3;
export const VERSION_NUMBER_MAX = 99_999;

/**
 * Zeigt die Nummer so kurz wie möglich: `2` statt `2.000`, aber `2.5` bleibt
 * `2.5`. Ohne das Abschneiden stünde in der Oberfläche überall `v1.000`.
 */
export function formatVersionNumber(value: number): string {
  if (!Number.isFinite(value)) return '?';
  const gerundet = Number(value.toFixed(VERSION_NUMBER_DECIMALS));
  return String(gerundet);
}

/** Wie `formatVersionNumber`, aber mit dem `v` davor. */
export function versionLabel(value: number): string {
  return `v${formatVersionNumber(value)}`;
}

/**
 * Für Dateinamen: Der Punkt würde dort wie eine Endung aussehen
 * (`…_v2.5_1080p25.mp4` liest sich schlecht), deshalb ein Bindestrich.
 */
export function versionForFilename(value: number): string {
  return `v${formatVersionNumber(value).replace('.', '-')}`;
}

export type VersionNumberProblem =
  | { ok: true; value: number }
  | { ok: false; reason: 'ungueltig' | 'zu-klein' | 'vergeben' | 'zu-gross'; message: string };

/**
 * Prüft eine gewünschte Nummer gegen den Bestand. Dieselbe Funktion läuft im
 * Browser (damit der Fehler vor dem Upload auffällt) und in der API (weil man
 * sich auf den Browser nicht verlassen darf).
 *
 * @param wunsch    Die eingegebene Nummer.
 * @param vorhanden Alle Nummern, die es in diesem Video schon gibt.
 */
export function checkVersionNumber(wunsch: number, vorhanden: number[]): VersionNumberProblem {
  if (!Number.isFinite(wunsch) || wunsch <= 0) {
    return { ok: false, reason: 'ungueltig', message: 'Die Versionsnummer muss größer als 0 sein.' };
  }
  if (wunsch > VERSION_NUMBER_MAX) {
    return {
      ok: false,
      reason: 'zu-gross',
      message: `Die Versionsnummer darf höchstens ${VERSION_NUMBER_MAX} sein.`,
    };
  }

  const wert = Number(wunsch.toFixed(VERSION_NUMBER_DECIMALS));
  // Der Vergleich läuft über die gerundeten Werte: Sonst gälte 2.0000001 als
  // größer als 2, obwohl beide als „2" in der Datenbank landen.
  const bestand = vorhanden.map((eintrag) => Number(eintrag.toFixed(VERSION_NUMBER_DECIMALS)));

  if (bestand.includes(wert)) {
    return {
      ok: false,
      reason: 'vergeben',
      message: `${versionLabel(wert)} gibt es in diesem Video schon.`,
    };
  }

  const hoechste = bestand.length > 0 ? Math.max(...bestand) : 0;
  if (wert <= hoechste) {
    return {
      ok: false,
      reason: 'zu-klein',
      message: `Die neue Fassung muss über ${versionLabel(hoechste)} liegen.`,
    };
  }

  return { ok: true, value: wert };
}

/** Vorschlag für die nächste Nummer: die nächste ganze Zahl über der höchsten. */
export function nextVersionNumber(vorhanden: number[]): number {
  const hoechste = vorhanden.length > 0 ? Math.max(...vorhanden) : 0;
  return Math.floor(hoechste) + 1;
}
