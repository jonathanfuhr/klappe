import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AWORK_QUEUE, type AworkJobData } from '../queue/queue.constants';
import { AworkError } from './awork.client';
import { AworkSettingsService } from './awork-settings.service';
import { AworkSyncService } from './awork-sync.service';

/**
 * Arbeitet die awork-Meldungen ab (Phase 30).
 *
 * Einer nach dem anderen: Die Aufträge greifen ineinander – zwei Läufe zur
 * selben Fassung würden dieselbe Aufgabe gleichzeitig lesen und schreiben, und
 * am Ende stünde die ältere Beschreibung darin. Schnell muss hier nichts sein;
 * es wartet niemand vor dem Bildschirm.
 */
@Processor(AWORK_QUEUE, { concurrency: 1 })
export class AworkProcessor extends WorkerHost {
  private readonly logger = new Logger(AworkProcessor.name);

  constructor(
    private readonly sync: AworkSyncService,
    private readonly settings: AworkSettingsService,
  ) {
    super();
  }

  async process(job: Job<AworkJobData>): Promise<void> {
    const data = job.data;
    try {
      switch (data.kind) {
        case 'korrekturen': {
          const geschrieben = await this.sync.korrekturen(data.versionId);
          if (geschrieben) this.logger.log(`Korrekturen zu Fassung ${data.versionId} in awork.`);
          break;
        }
        case 'kundenmaterial': {
          await this.sync.kundenmaterial(data.projectId);
          break;
        }
        case 'erstbesuch': {
          await this.sync.erstbesuch(data.userId, data.shareLinkId);
          break;
        }
        case 'fassung-verfuegbar': {
          await this.sync.fassungVerfuegbar(data.versionId);
          break;
        }
        case 'endfassung': {
          await this.sync.endfassung(data.versionId);
          break;
        }
        default: {
          // Unbekannte Art: nicht endlos wiederholen, nur festhalten.
          this.logger.warn(`Unbekannte awork-Aufgabe: ${JSON.stringify(data)}`);
          return;
        }
      }
      await this.settings.merkeErgebnis(null);
    } catch (error) {
      const meldung = error instanceof AworkError ? error.message : String(error);
      await this.settings.merkeErgebnis(meldung);

      /*
       * Was awork von sich aus nicht mag – ein falscher Schlüssel, ein
       * gelöschtes Projekt –, wird durch Wiederholen nicht besser. Solche
       * Aufträge enden hier still; die Ursache steht in den Einstellungen und
       * im Protokoll. Nur die vorübergehenden Fehler gehen zurück in die
       * Warteschlange.
       */
      if (error instanceof AworkError && !error.retryable) {
        this.logger.error(`awork-Auftrag ${job.id} aufgegeben: ${meldung}`);
        return;
      }
      throw error;
    }
  }
}
