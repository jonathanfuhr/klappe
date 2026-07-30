import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  TRANSCODE_JOB,
  TRANSCODE_PRIORITY,
  TRANSCODE_QUEUE,
  type TranscodeJobData,
} from './queue.constants';

@Injectable()
export class TranscodeQueueService {
  private readonly logger = new Logger(TranscodeQueueService.name);

  constructor(@InjectQueue(TRANSCODE_QUEUE) private readonly queue: Queue<TranscodeJobData>) {}

  /**
   * Die Job-ID ist die Versions-ID: Ein zweiter Anlauf für dieselbe Version
   * (etwa nach einem Neustart) erzeugt keinen doppelten Job.
   *
   * Bewusst ohne `priority`: BullMQ arbeitet Aufträge ohne Priorität vor allen
   * priorisierten ab. Die Abspielfassung drängelt sich damit immer vor die
   * Nacharbeit aus Phase 19.
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

  /**
   * Die HLS-Stufenleiter als eigener Auftrag (Phase 19).
   *
   * Früher lief sie im selben Durchgang wie die Abspielfassung – und hielt
   * damit auf, was der Player eigentlich schon hätte haben können. Jetzt ist
   * sie Nacharbeit: niedriger Vorrang, auf Wunsch erst im Zeitfenster.
   */
  async enqueueHls(versionId: string, delayMs = 0): Promise<void> {
    const jobId = `hls-${versionId}`;
    await this.queue.remove(jobId).catch(() => undefined);
    await this.queue.add(
      TRANSCODE_JOB,
      { hlsVersionId: versionId },
      { jobId, delay: delayMs, priority: TRANSCODE_PRIORITY.vorrat },
    );
    this.logger.log(
      `HLS-Leiter eingereiht: ${versionId}${delayMs > 0 ? ` (in ${Math.round(delayMs / 60_000)} min)` : ''}`,
    );
  }

  /**
   * Eine Download-Fassung aus einem Format-Preset (Phase 19).
   *
   * `angefordert` heißt: Jemand schaut gerade auf den Fortschrittsbalken –
   * dann wird weder gewartet noch hinten angestellt.
   */
  async enqueueRendition(
    renditionId: string,
    optionen: { angefordert: boolean; delayMs?: number },
  ): Promise<void> {
    const jobId = `rendition-${renditionId}`;
    await this.queue.remove(jobId).catch(() => undefined);
    await this.queue.add(
      TRANSCODE_JOB,
      { renditionId },
      {
        jobId,
        delay: optionen.angefordert ? 0 : (optionen.delayMs ?? 0),
        priority: optionen.angefordert
          ? TRANSCODE_PRIORITY.angefordert
          : TRANSCODE_PRIORITY.vorrat,
      },
    );
    this.logger.log(
      `Download-Fassung eingereiht: ${renditionId}` +
        (optionen.angefordert ? ' (angefordert)' : ' (Vorrat)'),
    );
  }
}
