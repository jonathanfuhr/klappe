import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { AuthSettingsService } from './auth-settings.service';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';
import { SettingsController } from './settings.controller';

@Module({
  imports: [MailModule],
  controllers: [SettingsController, BrandingController],
  providers: [BrandingService, AuthSettingsService],
  exports: [BrandingService, AuthSettingsService],
})
export class SettingsModule {}
