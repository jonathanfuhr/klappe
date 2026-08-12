import { Global, Module } from '@nestjs/common';
import { BrandProfilesController } from './brand-profiles.controller';
import { BrandProfilesService } from './brand-profiles.service';
import { SettingsService } from './settings.service';

/**
 * Auftritte: fremde Erscheinungsbilder pro Projekt (1.6).
 *
 * Eigenes Modul statt eines Zusatzes im `SettingsModule`, weil der Auftritt
 * an drei weit auseinanderliegenden Stellen gebraucht wird: beim Projekt,
 * bei der Freigabe-Vorschau und – im **Worker** – beim Mailversand. Über das
 * `SettingsModule` zu gehen brächte einen Ring, denn das hängt am
 * `MailModule`.
 *
 * `SettingsService` steht deshalb als eigener Anbieter da, wie schon im
 * `MailModule` und im `AworkModule`: Er ist zustandslos, und ein zweites
 * Exemplar kostet nichts.
 *
 * `@Global()` heißt „überall verfügbar, sobald irgendwo importiert" – der
 * Worker ist ein eigenes Wurzelmodul und muss das Modul trotzdem
 * ausdrücklich einbinden, sonst findet der Mailversand die Auftritte nicht.
 * Genau daran ist Phase 26 im Worker schon einmal gescheitert.
 */
@Global()
@Module({
  controllers: [BrandProfilesController],
  providers: [SettingsService, BrandProfilesService],
  exports: [BrandProfilesService],
})
export class BrandProfilesModule {}
