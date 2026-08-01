import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { QueueModule } from '../queue/queue.module';
import { RenditionsModule } from '../renditions/renditions.module';
import { VersionsController } from './versions.controller';
import { VersionsService } from './versions.service';

// MailModule wegen der Benachrichtigungen: Wer eine Fassung hochlädt, wird
// automatisch für das Video eingetragen (Phase 18).
// RenditionsModule, damit ein nachträglich gesetzter Endfassungs-Haken die
// Download-Formate anstößt (Phase 19).
// QueueModule, weil eine fertige oder fehlgeschlagene Fassung eine Mail
// einreiht (Phase 28).
@Module({
  imports: [MailModule, QueueModule, RenditionsModule],
  controllers: [VersionsController],
  providers: [VersionsService],
  exports: [VersionsService],
})
export class VersionsModule {}
