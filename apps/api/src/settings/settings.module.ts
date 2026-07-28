import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { SettingsController } from './settings.controller';

@Module({
  imports: [MailModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
