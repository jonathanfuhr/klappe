/**
 * Welcher Stand hier läuft (1.5.1).
 *
 * Die Version kommt aus der `package.json` des API-Pakets und folgt der
 * Branch-Nummer: Wer auf `version/1.5.1` ausrollt, sieht `1.5.1`. Sie wird zur
 * Laufzeit gelesen und nicht ins Bündel geschrieben – so kann sie nicht
 * auseinanderlaufen.
 *
 * Commit und Bauzeitpunkt kommen aus der Umgebung, weil sie im Container nicht
 * zu ermitteln sind: Ein `.git` liegt dort nicht, und die Dateizeit sagt nur
 * etwas über das Entpacken. Das Dockerfile reicht beide als Build-Argumente
 * durch; ohne sie bleibt das Feld `null` statt zu raten.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BuildInfoDto } from '@klappe/shared';

function leseVersion(): string {
  /*
   * Zwei Orte, weil der Pfad im Betrieb ein anderer ist als in der
   * Entwicklung: gebaut liegt diese Datei in `dist/common/`, im Quellbaum in
   * `src/common/`. Beide Male ist die `package.json` zwei Ebenen höher – nur
   * einmal über `dist`, einmal über `src`.
   */
  for (const pfad of [
    join(__dirname, '..', '..', 'package.json'),
    join(__dirname, '..', '..', '..', 'package.json'),
  ]) {
    try {
      const inhalt = JSON.parse(readFileSync(pfad, 'utf8')) as { name?: string; version?: string };
      // Nur die eigene `package.json` zählt – die des Monorepos trägt eine
      // andere Bedeutung, auch wenn dort zufällig dieselbe Nummer steht.
      if (inhalt.name === '@klappe/api' && inhalt.version) return inhalt.version;
    } catch {
      // Weiter zum nächsten Pfad; am Ende steht der Rückfall unten.
    }
  }
  return '0.0.0';
}

/** Einmal beim Start ermitteln – im Betrieb ändert sich davon nichts. */
const VERSION = leseVersion();

export function buildInfo(): BuildInfoDto {
  const commit = process.env.KLAPPE_COMMIT?.trim();
  const builtAt = process.env.KLAPPE_BUILT_AT?.trim();
  return {
    version: VERSION,
    // Sieben Zeichen genügen zum Wiederfinden und passen in eine Zeile.
    commit: commit ? commit.slice(0, 7) : null,
    builtAt: builtAt || null,
  };
}
