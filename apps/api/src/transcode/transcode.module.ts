import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { RenditionsModule } from '../renditions/renditions.module';
import { UploadsModule } from '../uploads/uploads.module';
import { VersionsModule } from '../versions/versions.module';
import { FfmpegService } from './ffmpeg.service';
import { TranscodeProcessor } from './transcode.processor';
import { TranscodeRecoveryService } from './transcode-recovery.service';

/**
 * Nur der Worker-Prozess lädt dieses Modul – die API soll keine
 * Transcoding-Jobs annehmen und damit Rechenzeit vom Webdienst abziehen.
 *
 * `UploadsModule` kommt seit Phase 18 dazu: Die Verarbeitung läuft schon,
 * bevor eine Fassung existiert, und muss danach selbst aufnehmen können.
 */
@Module({
  imports: [QueueModule, VersionsModule, UploadsModule, RenditionsModule],
  providers: [FfmpegService, TranscodeProcessor, TranscodeRecoveryService],
})
export class TranscodeModule {}
