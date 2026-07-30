import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MailModule } from '../mail/mail.module';
import { AuthSettingsService } from '../settings/auth-settings.service';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MicrosoftAuthController } from './microsoft/microsoft.controller';
import { MicrosoftAuthService } from './microsoft/microsoft.service';

@Module({
  // MailModule bringt den SettingsService mit, auf dem die
  // Anmeldeeinstellungen aufsetzen.
  imports: [JwtModule.register({}), UsersModule, MailModule],
  controllers: [AuthController, MicrosoftAuthController],
  providers: [AuthService, AuthSettingsService, MicrosoftAuthService],
  exports: [AuthService, AuthSettingsService],
})
export class AuthModule {}
