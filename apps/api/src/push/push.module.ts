import { Module } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { PushController } from './push.controller';
import { PushKeysService } from './push-keys.service';
import { PushService } from './push.service';

/**
 * Push für API und Worker (Phase 29).
 *
 * Beide brauchen es, aus verschiedenen Gründen: Der API-Prozess nimmt An- und
 * Abmeldungen entgegen, der Worker verschickt. Der `PushController` läuft nur
 * im API-Prozess mit – der Worker startet gar keinen HTTP-Server, Controller
 * sind dort wirkungslos.
 *
 * `SettingsService` steht hier als eigener Anbieter, wie schon im
 * `MailModule`: Er ist zustandslos, und ihn über das `SettingsModule` zu
 * holen brächte einen Ring, weil jenes seinerseits das `MailModule` braucht.
 */
@Module({
  controllers: [PushController],
  providers: [SettingsService, PushKeysService, PushService],
  exports: [PushService, PushKeysService],
})
export class PushModule {}
