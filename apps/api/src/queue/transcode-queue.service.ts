import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { TRANSCODE_JOB, TRANSCODE_QUEUE, type TranscodeJobData } from './queue.constants';

@Injectable()
export class TranscodeQueueService {
  private readonly logger = new Logger(TranscodeQueueService.name);

  constructor(@InjectQueue(TRANSCODE_QUEUE) private readonly queue: Queue<TranscodeJobData>) {}

  /**
   * Die Job-ID ist die Versions-ID: Ein zweiter Anlauf für dieselbe Version
   * (etwa nach einem Neustart) erzeugt keinen doppelten Job.
   */
  async enqueue(versionId: string): Promise<void> {
    await this.queue.remove(versionId).catch(() => undefined);
    await this.queue.add(TRANSCODE_JOB, { versionId }, { jobId: versionId });
    this.logger.log(`Transcoding eingereiht: ${versionId}`);
  }

  /**
   * Verarbeitung im Zwischenspeicher, noch ohne Fassung (Phase 18).
   *
   * Die Job-ID trägt ein Präfix, damit sie nie mit einer Versions-ID
   * kollidiert – mit Bindestrich, nicht mit Doppelpunkt: Den lässt BullMQ in
   * einer eigenen Job-ID nicht zu.
   */
  async enqueueUpload(uploadId: string): Promise<void> {
    const jobId = `upload-${uploadId}`;
    await this.queue.remove(jobId).catch(() => undefined);
    await this.queue.add(TRANSCODE_JOB, { uploadId }, { jobId });
    this.logger.log(`Verarbeitung im Zwischenspeicher eingereiht: ${uploadId}`);
  }
}
