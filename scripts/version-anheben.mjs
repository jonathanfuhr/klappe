#!/usr/bin/env node
/**
 * Die Versionsnummer anheben – in allen vier `package.json` auf einmal.
 *
 *   npm run version:bump           # 1.5.1 -> 1.5.2
 *   npm run version:bump -- 1.6.0  # ausdrücklich auf 1.6.0
 *
 * Warum überhaupt: Die Nummer folgt der Branch-Nummer (`version/1.5.1` →
 * `1.5.1`) und steht in der Oberfläche unter „Über diese Software". Nur so
 * ist einem laufenden Server anzusehen, welcher Stand dort tatsächlich
 * arbeitet – bei einem Aufbau mit zwei Hälften (Container und nativer Worker)
 * war genau das die häufigste Fehlerursache.
 *
 * Vier Dateien, weil die Pakete ihre Versionen einzeln führen; auseinander
 * laufen dürfen sie nicht, sonst zeigt die Oberfläche etwas anderes an als
 * die API meldet.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATEIEN = [
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function lies(datei) {
  return JSON.parse(readFileSync(join(WURZEL, datei), 'utf8'));
}

/**
 * Schreibt nur die Zeile mit der Version um, statt die Datei neu zu
 * serialisieren: `JSON.stringify` würde Schlüsselreihenfolge und Feinheiten
 * der Formatierung verändern und den Diff unlesbar machen.
 */
function schreibeVersion(datei, neu) {
  const pfad = join(WURZEL, datei);
  const inhalt = readFileSync(pfad, 'utf8');
  const ersetzt = inhalt.replace(/("version":\s*")[^"]+(")/, `$1${neu}$2`);
  if (ersetzt === inhalt) {
    throw new Error(`In ${datei} war keine Versionszeile zu finden.`);
  }
  writeFileSync(pfad, ersetzt);
}

const vorgabe = process.argv[2];
const aktuell = lies('package.json').version;

const treffer = SEMVER.exec(aktuell);
if (!treffer) {
  console.error(`Die aktuelle Version „${aktuell}" ist kein x.y.z – bitte von Hand setzen.`);
  process.exit(1);
}

let neu;
if (vorgabe) {
  if (!SEMVER.test(vorgabe)) {
    console.error(`„${vorgabe}" ist keine Versionsnummer der Form x.y.z.`);
    process.exit(1);
  }
  neu = vorgabe;
} else {
  const [, major, minor, patch] = treffer;
  neu = `${major}.${minor}.${Number(patch) + 1}`;
}

// Erst alle prüfen, dann alle schreiben: Ein Abbruch in der Mitte hinterließe
// Pakete mit verschiedenen Nummern – genau der Zustand, den das hier
// verhindern soll.
const abweichend = DATEIEN.filter((datei) => lies(datei).version !== aktuell);
if (abweichend.length > 0) {
  console.error('Die Pakete tragen verschiedene Versionen:');
  for (const datei of DATEIEN) console.error(`  ${lies(datei).version.padEnd(10)} ${datei}`);
  console.error('Bitte angleichen, dann erneut versuchen.');
  process.exit(1);
}

for (const datei of DATEIEN) schreibeVersion(datei, neu);

console.log(`Version ${aktuell} → ${neu}`);
console.log(`Passender Branch wäre: version/${neu}`);
