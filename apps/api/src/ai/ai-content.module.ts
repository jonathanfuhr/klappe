import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { AiContentController } from './ai-content.controller';
import { AiContentService } from './ai-content.service';

/** `MailModule` bringt den `SettingsService` mit, an dem der Schalter hängt. */
@Module({
  imports: [MailModule],
  controllers: [AiContentController],
  providers: [AiContentService],
  exports: [AiContentService],
})
export class AiContentModule {}
