import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { TranscodeQueueService } from '../queue/transcode-queue.service';
import { UploadTranscodeService } from '../uploads/upload-transcode.service';
import { VersionsService } from '../versions/versions.service';

/**
 * Wird der Worker mitten in einem Transcoding neu gestartet, bleibt die
 * Version auf `PROCESSING` stehen und niemand fasst sie wieder an. Beim Start
 * werden solche Fälle erneut eingereiht.
 *
 * Seit Phase 18 gilt dasselbe für die Verarbeitung im Zwischenspeicher: Auch
 * eine Datei, die noch keiner Fassung gehört, bliebe sonst für immer bei
 * „wird verarbeitet“ stehen.
 */
@Injectable()
export class TranscodeRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TranscodeRecoveryService.name);

  constructor(
    private readonly versionsService: VersionsService,
    private readonly uploadTranscode: UploadTranscodeService,
    private readonly queue: TranscodeQueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const stuck = await this.versionsService.findStuckProcessing();
    if (stuck.length > 0) {
      this.logger.log(`${stuck.length} unterbrochene(s) Transcoding wird erneut eingereiht.`);
      for (const version of stuck) {
        if (!version.originalKey) continue;
        await this.queue.enqueue(version.id);
      }
    }

    const liegengeblieben = await this.uploadTranscode.findStuck();
    if (liegengeblieben.length > 0) {
      this.logger.log(
        `${liegengeblieben.length} unterbrochene Verarbeitung(en) im Zwischenspeicher werden erneut eingereiht.`,
      );
      for (const row of liegengeblieben) {
        await this.queue.enqueueUpload(row.id);
      }
    }
  }
}
