import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { NotificationSettingsService } from '../settings/notification-settings.service';
import { SettingsService } from '../settings/settings.service';
import { MailService } from './mail.service';
import { Ms365OauthService } from './ms365-oauth.service';
import { NotificationCenterController } from './notification-center.controller';
import { NotificationCenterService } from './notification-center.service';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Versand-Grundlage für API und Worker. Die Auswahl der Empfänger
 * (`NotificationsService`) hängt bewusst nicht hier drin – die braucht nur
 * der Worker.
 *
 * Der `SubscriptionsController` läuft nur im API-Prozess mit: Der Worker
 * startet gar keinen HTTP-Server, Controller sind dort wirkungslos.
 */
@Module({
  // Die Zentrale stösst den Push an – dieselbe Stelle, dieselbe Sekunde.
  imports: [PushModule],
  controllers: [SubscriptionsController, NotificationCenterController],
  providers: [
    SettingsService,
    NotificationSettingsService,
    MailService,
    Ms365OauthService,
    SubscriptionsService,
    NotificationCenterService,
  ],
  exports: [
    SettingsService,
    NotificationSettingsService,
    MailService,
    SubscriptionsService,
    NotificationCenterService,
  ],
})
export class MailModule {}
