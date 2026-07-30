import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { MAIL_JOB, MAIL_PRIORITY, MAIL_QUEUE, type MailJobData } from './queue.constants';

@Injectable()
export class MailQueueService {
  private readonly logger = new Logger(MailQueueService.name);

  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue<MailJobData>) {}

  /**
   * Ein fehlgeschlagener Versand darf die auslösende Aktion nie umwerfen:
   * Ein Kommentar ist gespeichert, auch wenn Redis gerade klemmt.
   */
  async enqueue(data: MailJobData, delayMs = 0): Promise<void> {
    try {
      await this.queue.add(MAIL_JOB, data, {
        // Vorratsarbeit, hinter allem Dringenden (siehe `MAIL_PRIORITY`).
        priority: MAIL_PRIORITY.sammel,
        ...(delayMs > 0 ? { delay: Math.round(delayMs) } : {}),
      });
    } catch (error) {
      this.logger.error(`Benachrichtigung konnte nicht eingereiht werden: ${String(error)}`);
    }
  }
}
