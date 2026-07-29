import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module';
import { EventsModule } from './events/events.module';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { MailModule } from './mail/mail.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { MailProcessor } from './mail/mail.processor';
import { NotificationsService } from './mail/notifications.service';
import { QueueModule } from './queue/queue.module';
import { TranscodeSettingsModule } from './settings/transcode-settings.module';
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
    EventsModule,
    TranscodeSettingsModule,
    QueueModule,
    VersionsModule,
    TranscodeModule,
    MailModule,
    // Das Aufräumen gehört in den Worker: Es liest das ganze Volume ab und
    // hat in einem Prozess nichts verloren, der Anfragen beantworten soll.
    MaintenanceModule,
  ],
  providers: [NotificationsService, MailProcessor],
})
export class WorkerModule {}
