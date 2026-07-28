import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { TranscodeQueueService } from '../queue/transcode-queue.service';
import { VersionsService } from '../versions/versions.service';

/**
 * Wird der Worker mitten in einem Transcoding neu gestartet, bleibt die
 * Version auf `PROCESSING` stehen und niemand fasst sie wieder an. Beim Start
 * werden solche Fälle erneut eingereiht.
 */
@Injectable()
export class TranscodeRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TranscodeRecoveryService.name);

  constructor(
    private readonly versionsService: VersionsService,
    private readonly queue: TranscodeQueueService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const stuck = await this.versionsService.findStuckProcessing();
    if (stuck.length === 0) return;

    this.logger.log(`${stuck.length} unterbrochene(s) Transcoding wird erneut eingereiht.`);
    for (const version of stuck) {
      if (!version.originalKey) continue;
      await this.queue.enqueue(version.id);
    }
  }
}
