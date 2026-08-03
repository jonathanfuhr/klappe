import { Module } from '@nestjs/common';
import { AworkModule } from '../awork/awork.module';
import { MailModule } from '../mail/mail.module';
import { ProjectFilesModule } from '../project-files/project-files.module';
import { ProjectsModule } from '../projects/projects.module';
import { QueueModule } from '../queue/queue.module';
import { RenditionsModule } from '../renditions/renditions.module';
import { VersionsModule } from '../versions/versions.module';
import { VideosModule } from '../videos/videos.module';
import { UploadTranscodeService } from './upload-transcode.service';
import { UploadsCleanupService } from './uploads-cleanup.service';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [
    VersionsModule,
    VideosModule,
    ProjectsModule,
    ProjectFilesModule,
    QueueModule,
    // Wegen der Ruhezeit für Kundenmaterial (Phase 28): Die steht im
    // `NotificationSettingsService`, und der kommt aus dem Mail-Modul.
    // `VersionsModule` bindet es zwar auch ein, reicht es aber nicht weiter –
    // Importe sind bei Nest keine Exporte.
    MailModule,
    // Nacharbeit (HLS, Download-Formate) nach der Übernahme aus dem
    // Zwischenspeicher – dort wird `markReady` direkt aufgerufen, nicht über
    // den Worker (Phase 19).
    RenditionsModule,
    // Kundenmaterial wandert seit Phase 30 auch als Kommentar ins
    // awork-Projekt – dieselbe Ruhezeit wie die Sammelmail.
    AworkModule,
  ],
  controllers: [UploadsController],
  providers: [UploadsService, UploadsCleanupService, UploadTranscodeService],
  // `UploadTranscodeService` geht nach draußen, weil der Worker ihn braucht:
  // Dort läuft die Verarbeitung im Zwischenspeicher (Phase 18).
  exports: [UploadsService, UploadTranscodeService],
})
export class UploadsModule {}
