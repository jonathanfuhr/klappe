/**
 * Findet jeden Dienst, der in seinem Modul gar nicht aufzulösen ist.
 *
 * Nest löst Abhängigkeiten erst **beim Starten** auf. Typecheck, Tests und
 * Build sehen davon nichts: Ein Konstruktor-Parameter, dessen Modul niemand
 * eingebunden hat, fällt erst im Container auf – als Neustartschleife, also
 * genau dann, wenn niemand mehr an die Anwendung kommt. Am 01.08.2026 hat das
 * die Anlage lahmgelegt, weil `VersionsService` den `MailQueueService` bekam
 * und `VersionsModule` das `QueueModule` nicht einband.
 *
 * **Warum ein Skript und kein Test:** Die Prüfung braucht die Metadaten aus
 * `emitDecoratorMetadata`. Die erzeugt nur `tsc`; vitest transpiliert mit
 * esbuild, und dort fehlen sie ersatzlos. Ein Test dagegen wäre grün, ohne je
 * etwas anzusehen – schlimmer als keiner. Deshalb läuft das hier über `dist`
 * und hängt am `build`-Skript: Was hier auffällt, wird gar nicht erst zu einem
 * Image.
 *
 * Ein echter Start scheidet aus: `QueueModule` baut beim Erzeugen eine
 * Redis-Verbindung auf. Der Modulgraph wird deshalb **statisch** abgelaufen –
 * dieselbe Rechnung wie bei Nest, nur ohne Ein- und Ausgabe.
 *
 * Geprüft wird bewusst nur, was im Graphen **irgendwo** bereitgestellt wird.
 * Alles andere kommt von außen (Nest selbst, `Reflector`, Werte aus
 * dynamischen Modulen) und geht diese Prüfung nichts an – sonst meldete sie
 * Dinge, die in Ordnung sind, und würde bald übergangen.
 */
import 'reflect-metadata';
import { AppModule } from '../dist/app.module.js';
import { WorkerModule } from '../dist/worker.module.js';

function meta(ziel, schluessel) {
  if (!ziel || (typeof ziel !== 'function' && typeof ziel !== 'object')) return [];
  return Reflect.getMetadata(schluessel, ziel) ?? [];
}

/** Dynamische Module (`BullModule.forRoot()`) tragen ihre Angaben am Objekt. */
function zerlege(eintrag) {
  if (!eintrag) return null;

  if (typeof eintrag === 'object' && 'module' in eintrag) {
    const modul = eintrag.module;
    return {
      modul,
      imports: eintrag.imports ?? meta(modul, 'imports'),
      providers: eintrag.providers ?? meta(modul, 'providers'),
      controllers: eintrag.controllers ?? meta(modul, 'controllers'),
      exports: eintrag.exports ?? meta(modul, 'exports'),
      global: Boolean(eintrag.global) || Boolean(Reflect.getMetadata('__module:global__', modul)),
    };
  }

  if (typeof eintrag !== 'function') return null;
  return {
    modul: eintrag,
    imports: meta(eintrag, 'imports'),
    providers: meta(eintrag, 'providers'),
    controllers: meta(eintrag, 'controllers'),
    exports: meta(eintrag, 'exports'),
    global: Boolean(Reflect.getMetadata('__module:global__', eintrag)),
  };
}

/** Der Schlüssel, unter dem ein Provider zu haben ist. */
function token(provider) {
  return provider && typeof provider === 'object' && 'provide' in provider
    ? provider.provide
    : provider;
}

function name(wert) {
  return typeof wert === 'function' ? wert.name : String(wert);
}

/** Alle Module unter einem Wurzelmodul, jedes genau einmal. */
function sammle(wurzel) {
  const gefunden = new Map();
  const offen = [wurzel];

  while (offen.length > 0) {
    const teile = zerlege(offen.pop());
    if (!teile || gefunden.has(teile.modul)) continue;
    gefunden.set(teile.modul, teile);
    offen.push(...teile.imports);
  }
  return gefunden;
}

/**
 * Was ein Modul sieht: die eigenen Provider, die Exporte seiner Importe – und
 * die Exporte aller globalen Module. Ein exportiertes **Modul** reicht dessen
 * Exporte durch, deshalb der rekursive Zweig.
 */
function sichtbar(teile, alle) {
  const sichtbare = new Set(teile.providers.map(token));

  const exporteVon = (eintrag, tiefe = 0) => {
    const ziel = zerlege(eintrag);
    if (!ziel || tiefe > 10) return [];
    const bekannt = alle.get(ziel.modul) ?? ziel;
    return bekannt.exports.flatMap((ausfuhr) => {
      const alsModul = zerlege(ausfuhr);
      if (alsModul && alle.has(alsModul.modul) && alsModul.modul === ausfuhr) {
        return exporteVon(ausfuhr, tiefe + 1);
      }
      return [token(ausfuhr)];
    });
  };

  for (const eingebunden of teile.imports) {
    for (const ausfuhr of exporteVon(eingebunden)) sichtbare.add(ausfuhr);
  }
  for (const anderes of alle.values()) {
    if (!anderes.global) continue;
    for (const ausfuhr of exporteVon(anderes.modul)) sichtbare.add(ausfuhr);
  }
  return sichtbare;
}

/** Konstruktor-Parameter einer Klasse, mit `@Inject`-Token an ihrer Stelle. */
function abhaengigkeiten(klasse) {
  const typen = [...meta(klasse, 'design:paramtypes')];
  for (const eintrag of meta(klasse, 'self:paramtypes')) {
    typen[eintrag.index] = eintrag.param;
  }
  return typen;
}

function pruefe(wurzelname, wurzel) {
  const alle = sammle(wurzel);

  const bereitgestellt = new Set();
  for (const teile of alle.values()) {
    for (const provider of teile.providers) bereitgestellt.add(token(provider));
  }

  const fehler = [];
  for (const teile of alle.values()) {
    const sichtbare = sichtbar(teile, alle);
    const zuPruefen = [
      ...teile.providers.filter((provider) => typeof provider === 'function'),
      ...teile.controllers,
    ];

    for (const klasse of zuPruefen) {
      if (typeof klasse !== 'function') continue;
      for (const bedarf of abhaengigkeiten(klasse)) {
        if (bedarf === undefined || !bereitgestellt.has(bedarf)) continue;
        if (sichtbare.has(bedarf)) continue;
        fehler.push(
          `${wurzelname}: ${klasse.name} braucht ${name(bedarf)}, aber ` +
            `${name(teile.modul)} bindet das liefernde Modul nicht ein.`,
        );
      }
    }
  }
  return fehler;
}

const fehler = [...pruefe('AppModule', AppModule), ...pruefe('WorkerModule', WorkerModule)];

if (fehler.length > 0) {
  console.error('[abhängigkeiten] Der Container würde in eine Neustartschleife laufen:\n');
  for (const zeile of fehler) console.error(`  · ${zeile}`);
  console.error('\nBitte das liefernde Modul in `imports` des betroffenen Moduls aufnehmen.');
  process.exit(1);
}

const module = sammle(AppModule).size + sammle(WorkerModule).size;
console.log(`[abhängigkeiten] ${module} Module geprüft, alles auflösbar.`);
