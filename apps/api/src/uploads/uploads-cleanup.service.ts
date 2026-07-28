import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { UploadsService } from './uploads.service';

const INTERVAL_MS = 60 * 60 * 1000;

/**
 * Stündlicher Aufräumer für abgebrochene Upload-Sitzungen. Bewusst als
 * schlichtes Intervall statt mit einem Scheduler-Paket – ein Timer im
 * API-Prozess reicht für genau diese eine Aufgabe.
 */
@Injectable()
export class UploadsCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadsCleanupService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly uploadsService: UploadsService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.run();
    }, INTERVAL_MS);
    // Der Timer darf den Prozess beim Herunterfahren nicht offen halten.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    try {
      const removed = await this.uploadsService.cleanupExpired();
      if (removed > 0) {
        this.logger.log(`${removed} abgelaufene Upload-Sitzung(en) aufgeräumt.`);
      }
    } catch (error) {
      this.logger.error(`Aufräumen fehlgeschlagen: ${String(error)}`);
    }
  }
}
