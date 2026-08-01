import { describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
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

describe('Wurzelmodule', () => {
  it.each([
    ['AppModule', AppModule],
    ['WorkerModule', WorkerModule],
  ])('%s bindet das I18nModule ein', (_name, modul) => {
    expect(importe(modul)).toContain(I18nModule);
  });
});
