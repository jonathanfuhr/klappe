import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { VersionsModule } from '../versions/versions.module';
import { FfmpegService } from './ffmpeg.service';
import { TranscodeProcessor } from './transcode.processor';
import { TranscodeRecoveryService } from './transcode-recovery.service';

/**
 * Nur der Worker-Prozess lädt dieses Modul – die API soll keine
 * Transcoding-Jobs annehmen und damit Rechenzeit vom Webdienst abziehen.
 */
@Module({
  imports: [QueueModule, VersionsModule],
  providers: [FfmpegService, TranscodeProcessor, TranscodeRecoveryService],
})
export class TranscodeModule {}
