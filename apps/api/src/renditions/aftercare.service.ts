import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { videoVersions } from '../db/schema';
import { TranscodeQueueService } from '../queue/transcode-queue.service';
import { TranscodeSettingsService } from '../settings/transcode-settings.service';
import { delayUntilWindow } from '../transcode/transcode-window';
import { RenditionsService } from './renditions.service';

/**
 * Was nach der Abspielfassung noch dran ist (Phase 19).
 *
 * Bis Phase 18 hing die HLS-Leiter im selben Durchgang wie der Proxy und hielt
 * damit auf, was der Player längst hätte haben können. Jetzt ist beides
 * Nacharbeit: eigene Aufträge, niedriger Vorrang, auf Wunsch erst im
 * Zeitfenster. Die Fassung gilt vorher schon als fertig – sie ist es ja auch.
 *
 * Aufgerufen wird das an genau zwei Stellen: wenn der Worker eine Fassung
 * fertig gemeldet hat, und wenn eine im Zwischenspeicher vorverarbeitete Datei
 * ihren Platz gefunden hat.
 */
@Injectable()
export class AftercareService {
  private readonly logger = new Logger(AftercareService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: TranscodeSettingsService,
    private readonly queue: TranscodeQueueService,
    private readonly renditions: RenditionsService,
  ) {}

  async schedule(versionId: string): Promise<void> {
    const einstellungen = await this.settings.effective();
    const delayMs = delayUntilWindow(new Date(), einstellungen.window);

    if (einstellungen.hlsEnabled) {
      const [version] = await this.db
        .select({ hlsKey: videoVersions.hlsKey, status: videoVersions.status })
        .from(videoVersions)
        .where(eq(videoVersions.id, versionId))
        .limit(1);
      // Nicht noch einmal, wenn schon eine Leiter dasteht – etwa nach einem
      // Neustart mitten in der Warteschlange.
      if (version && version.status === 'READY' && !version.hlsKey) {
        await this.queue.enqueueHls(versionId, delayMs);
      }
    }

    await this.renditions.prebuildFor(versionId);
  }

  /** Fehler in der Nacharbeit dürfen die fertige Fassung nicht umwerfen. */
  async scheduleQuietly(versionId: string): Promise<void> {
    try {
      await this.schedule(versionId);
    } catch (error) {
      this.logger.warn(`Nacharbeit konnte nicht eingereiht werden (${versionId}): ${String(error)}`);
    }
  }
}
