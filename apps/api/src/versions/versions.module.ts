import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { VersionsController } from './versions.controller';
import { VersionsService } from './versions.service';

// MailModule wegen der Benachrichtigungen: Wer eine Fassung hochlädt, wird
// automatisch für das Video eingetragen (Phase 18).
@Module({
  imports: [MailModule],
  controllers: [VersionsController],
  providers: [VersionsService],
  exports: [VersionsService],
})
export class VersionsModule {}
