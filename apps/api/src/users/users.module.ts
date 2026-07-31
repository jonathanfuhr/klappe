import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { AuthSettingsService } from '../settings/auth-settings.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * `AuthSettingsService` liefert seit Phase 24 die Passwort-Richtlinie, an der
 * sich jedes neu gesetzte Passwort messen lassen muss. `MailModule` bringt den
 * `SettingsService` mit, auf dem sie aufsetzt – wie schon im `AuthModule`.
 */
@Module({
  imports: [MailModule],
  controllers: [UsersController],
  providers: [UsersService, AuthSettingsService],
  exports: [UsersService],
})
export class UsersModule {}
