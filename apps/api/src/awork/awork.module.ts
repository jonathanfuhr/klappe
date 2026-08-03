import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { QueueModule } from '../queue/queue.module';
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
 * `MailModule` steuert den `SettingsService` bei – von dort kommt die Ruhezeit
 * der Sammelmail, an der sich das Sammeln nach awork orientiert.
 */
@Module({
  imports: [MailModule, QueueModule],
  controllers: [AworkController],
  providers: [AworkSettingsService, AworkClient, AworkLinksService, AworkNotifyService],
  exports: [AworkSettingsService, AworkClient, AworkLinksService, AworkNotifyService],
})
export class AworkModule {}
