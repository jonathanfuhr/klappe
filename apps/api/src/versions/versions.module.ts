import { Module } from '@nestjs/common';
import { AworkModule } from '../awork/awork.module';
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
  // AworkModule, weil eine beim Kunden angekommene Fassung und der
  // Endfassungs-Haken als Kommentar ins awork-Projekt gehen (Phase 30).
  imports: [MailModule, QueueModule, RenditionsModule, AworkModule],
  controllers: [VersionsController],
  providers: [VersionsService],
  exports: [VersionsService],
})
export class VersionsModule {}
