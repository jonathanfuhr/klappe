import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { SettingsService } from '../settings/settings.service';
import { AworkClient } from './awork.client';
import { AworkController } from './awork.controller';
import { AworkLinksService } from './awork-links.service';
import { AworkNotifyService } from './awork-notify.service';
import { AworkSettingsService } from './awork-settings.service';

/**
 * Die awork-Anbindung (Phase 30) – der Teil, den beide Prozesse brauchen.
 *
 * Der eigentliche Sync (`AworkSyncService`, `AworkProcessor`) hängt bewusst
 * **nicht** hier drin, sondern im Worker-Wurzelmodul: Im API-Prozess soll kein
 * Verarbeiter auf der Warteschlange sitzen. Dasselbe Muster wie beim
 * Mailversand, wo `NotificationsService` und `MailProcessor` auch dort stehen.
 *
 * `SettingsService` steht hier als eigener Anbieter, wie schon im `MailModule`
 * und im `PushModule`: Er ist zustandslos, und ihn über ein anderes Modul zu
 * holen brächte einen Ring – dieses Modul wird unter anderem vom `AccessModule`
 * eingebunden, und das ist `@Global()`.
 */
@Module({
  imports: [QueueModule],
  controllers: [AworkController],
  providers: [
    SettingsService,
    AworkSettingsService,
    AworkClient,
    AworkLinksService,
    AworkNotifyService,
  ],
  exports: [AworkSettingsService, AworkClient, AworkLinksService, AworkNotifyService],
})
export class AworkModule {}
