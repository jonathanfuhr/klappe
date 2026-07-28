import { Module } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { MailService } from './mail.service';

/**
 * Versand-Grundlage für API und Worker. Die Auswahl der Empfänger
 * (`NotificationsService`) hängt bewusst nicht hier drin – die braucht nur
 * der Worker.
 */
@Module({
  providers: [SettingsService, MailService],
  exports: [SettingsService, MailService],
})
export class MailModule {}
