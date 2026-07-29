import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MAIL_QUEUE, type MailJobData } from '../queue/queue.constants';
import { NotificationsService } from './notifications.service';

/**
 * Verschickt die eingereihten Benachrichtigungen. Mehrere gleichzeitig, weil
 * hier nur auf den Mailserver gewartet wird – anders als beim Transcoding
 * kostet das keine Rechenzeit.
 */
@Processor(MAIL_QUEUE, { concurrency: 4 })
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async process(job: Job<MailJobData>): Promise<void> {
    const data = job.data;
    switch (data.kind) {
      case 'comment': {
        const sent = await this.notifications.notifyNewComment(data.commentId);
        if (sent > 0) this.logger.log(`${sent} Benachrichtigung(en) zu Kommentar ${data.commentId}`);
        break;
      }
      case 'digest': {
        await this.notifications.flushDigest(data.userId, data.videoId);
        break;
      }
      case 'project-file': {
        const sent = await this.notifications.notifyProjectFile(data.projectFileId);
        if (sent > 0) this.logger.log(`${sent} Hinweis(e) zu Kunden-Upload ${data.projectFileId}`);
        break;
      }
      default: {
        // Unbekannte Job-Art: nicht endlos wiederholen, nur festhalten.
        this.logger.warn(`Unbekannte Mail-Aufgabe: ${JSON.stringify(data)}`);
      }
    }
  }
}
