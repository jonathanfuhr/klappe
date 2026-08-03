import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { AworkModule } from './awork/awork.module';
import { AworkProcessor } from './awork/awork.processor';
import { AworkSyncService } from './awork/awork-sync.service';
import { I18nModule } from './i18n/i18n.module';
import { WorkerModule } from './worker.module';

/**
 * Die beiden Wurzelmodule gegen eine Falle, die erst im Container auffällt.
 *
 * `I18nModule` ist `@Global()`. Global heißt bei Nest aber nicht „immer da",
 * sondern „überall verfügbar, **sobald** es irgendwo importiert wurde". Der
 * Worker ist ein eigenes Wurzelmodul und sieht `AppModule` nie – dort fehlte
 * der Import, und der Container lief in eine Neustartschleife, weil
 * `MailService` seinen `LocaleService` nicht fand.
 *
 * Der Typecheck sieht das nicht, die Tests sahen es nicht, und der Build
 * ebenso wenig: Nest löst Abhängigkeiten erst beim Starten auf. Also hier.
 */
function importe(modul: object): unknown[] {
  return (Reflect.getMetadata('imports', modul) as unknown[] | undefined) ?? [];
}

function anbieter(modul: object): unknown[] {
  return (Reflect.getMetadata('providers', modul) as unknown[] | undefined) ?? [];
}

describe('Wurzelmodule', () => {
  it.each([
    ['AppModule', AppModule],
    ['WorkerModule', WorkerModule],
  ])('%s bindet das I18nModule ein', (_name, modul) => {
    expect(importe(modul)).toContain(I18nModule);
  });

  /*
   * Dieselbe Falle für die awork-Anbindung (Phase 30): Der Verarbeiter steht
   * im Worker-Wurzelmodul, seine Abhängigkeiten kommen aus `AworkModule`.
   * Fehlt der Import, startet der Container nicht – und zwar erst im Betrieb,
   * nicht beim Übersetzen.
   */
  it('WorkerModule verarbeitet die awork-Warteschlange', () => {
    expect(importe(WorkerModule)).toContain(AworkModule);
    expect(anbieter(WorkerModule)).toContain(AworkProcessor);
    expect(anbieter(WorkerModule)).toContain(AworkSyncService);
  });

  it('AppModule reiht awork-Meldungen nur ein und verarbeitet sie nicht', () => {
    // Ein Verarbeiter im API-Prozess würde dieselbe Aufgabe ein zweites Mal
    // anfassen – genau das soll die Trennung verhindern.
    expect(importe(AppModule)).toContain(AworkModule);
    expect(anbieter(AppModule)).not.toContain(AworkProcessor);
  });

  /*
   * Ringe im Importgraphen (Phase 30).
   *
   * Nest löst sie nur mit `forwardRef` auf, und bis dahin startet der Container
   * gar nicht oder – schlimmer – ein Anbieter kommt als `undefined` an. Der
   * Übersetzer sieht davon nichts. Die awork-Anbindung hängt an vier Stellen
   * im Baum, unter anderem am `AccessModule`, und das ist `@Global()`; deshalb
   * wird der Graph hier einmal ganz abgelaufen.
   */
  it.each([
    ['AppModule', AppModule],
    ['WorkerModule', WorkerModule],
  ])('%s hat keine Modul-Ringe', (_name, wurzel) => {
    const ringe: string[] = [];
    const pfad: object[] = [];
    const fertig = new Set<object>();

    const lauf = (modul: object): void => {
      const stelle = pfad.indexOf(modul);
      if (stelle !== -1) {
        ringe.push([...pfad.slice(stelle), modul].map(nameVon).join(' → '));
        return;
      }
      if (fertig.has(modul)) return;

      pfad.push(modul);
      for (const eintrag of importe(modul)) {
        // `DynamicModule` (etwa `JwtModule.register({})`) trägt das eigentliche
        // Modul unter `module`; alles ohne Metadaten wird übersprungen.
        const naechstes =
          typeof eintrag === 'function'
            ? eintrag
            : ((eintrag as { module?: object } | null)?.module ?? null);
        if (naechstes) lauf(naechstes);
      }
      pfad.pop();
      fertig.add(modul);
    };

    lauf(wurzel);
    expect(ringe).toEqual([]);
  });
});

function nameVon(modul: object): string {
  return (modul as { name?: string }).name ?? 'unbekannt';
}
