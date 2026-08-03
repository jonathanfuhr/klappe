import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module';
import { AworkModule } from './awork/awork.module';
import { AworkProcessor } from './awork/awork.processor';
import { AworkSyncService } from './awork/awork-sync.service';
import { EventsModule } from './events/events.module';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { I18nModule } from './i18n/i18n.module';
import { MailModule } from './mail/mail.module';
import { BackupSchedulerModule } from './backup/backup-scheduler.module';
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
    /*
     * Muss hier ausdrücklich stehen, obwohl `I18nModule` `@Global()` ist:
     * Global heißt „überall verfügbar, sobald irgendwo importiert" – und der
     * Worker ist ein eigenes Wurzelmodul, das `AppModule` nie sieht. Ohne
     * diese Zeile findet `MailService` den `LocaleService` nicht und der
     * Container läuft in eine Neustartschleife (gefunden am 2026-08-01, hat
     * den Worker seit dem Ausrollen von Phase 26 lahmgelegt).
     */
    I18nModule,
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
    BackupSchedulerModule,
    // Die awork-Anbindung (Phase 30). Der Verarbeiter steht wie beim Mailversand
    // hier und nicht im Modul selbst: Im API-Prozess soll niemand auf der
    // Warteschlange sitzen.
    AworkModule,
  ],
  providers: [NotificationsService, MailProcessor, AworkSyncService, AworkProcessor],
})
export class WorkerModule {}
