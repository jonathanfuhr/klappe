import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { MailModule } from './mail/mail.module';
import { MailProcessor } from './mail/mail.processor';
import { NotificationsService } from './mail/notifications.service';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { TranscodeModule } from './transcode/transcode.module';
import { VersionsModule } from './versions/versions.module';

/**
 * Der Hintergrundprozess: Transcoding und Mailversand. Kein HTTP-Server –
 * dieser Container hört ausschließlich auf die Warteschlangen in Redis.
 */
@Module({
  imports: [
    AppConfigModule,
    DbModule,
    StorageModule,
    AccessModule,
    QueueModule,
    VersionsModule,
    TranscodeModule,
    MailModule,
  ],
  providers: [NotificationsService, MailProcessor],
})
export class WorkerModule {}
