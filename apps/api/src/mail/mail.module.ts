import { Module } from '@nestjs/common';
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
  controllers: [SubscriptionsController, NotificationCenterController],
  providers: [
    SettingsService,
    MailService,
    Ms365OauthService,
    SubscriptionsService,
    NotificationCenterService,
  ],
  exports: [SettingsService, MailService, SubscriptionsService, NotificationCenterService],
})
export class MailModule {}
