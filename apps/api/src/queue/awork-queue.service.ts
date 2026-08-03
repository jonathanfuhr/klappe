import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AWORK_JOB, AWORK_QUEUE, type AworkJobData } from './queue.constants';

/**
 * Das Einreihen der awork-Meldungen (Phase 30).
 *
 * Zwei Dinge macht dieser Dienst, und beide sind wichtiger, als sie aussehen:
 *
 * **Er sammelt.** Ein Auftrag bekommt eine feste Kennung – etwa
 * `korrekturen:<Fassung>` – und wartet die Ruhezeit ab. Kommt in dieser Zeit
 * ein weiterer Kommentar, findet BullMQ die Kennung schon vor und legt nichts
 * Neues an; der wartende Auftrag nimmt die Änderung beim Ausführen von selbst
 * mit, weil die Beschreibung ohnehin frisch aus der Datenbank entsteht. Aus
 * zwanzig Kommentaren in fünf Minuten wird ein Schreibvorgang.
 *
 * **Er wirft nie.** Ein Kommentar ist gespeichert, auch wenn Redis klemmt oder
 * awork gerade nicht mag – genauso wie beim Mailversand. Die Anbindung ist
 * Zusatznutzen, kein Teil des Speicherns.
 */
@Injectable()
export class AworkQueueService {
  private readonly logger = new Logger(AworkQueueService.name);

  constructor(@InjectQueue(AWORK_QUEUE) private readonly queue: Queue<AworkJobData>) {}

  private async enqueue(data: AworkJobData, jobId: string, delayMs = 0): Promise<void> {
    try {
      await this.queue.add(AWORK_JOB, data, {
        jobId,
        ...(delayMs > 0 ? { delay: Math.round(delayMs) } : {}),
        /*
         * Nach dem Erledigen sofort weg: Sonst würde BullMQ die Kennung noch
         * kennen und die nächste Runde desselben Gegenstands stillschweigend
         * verschlucken. Genau das Verhalten, das oben beim Sammeln erwünscht
         * ist, wäre hier ein Datenverlust.
         */
        removeOnComplete: true,
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      });
    } catch (error) {
      this.logger.error(`awork-Auftrag ${jobId} konnte nicht eingereiht werden: ${String(error)}`);
    }
  }

  /**
   * Kommentare einer Fassung. `delayMs` ist die Ruhezeit der Sammelmail –
   * dieselbe Einstellung, damit awork und Postfach im selben Takt laufen.
   */
  async korrekturen(versionId: string, delayMs: number): Promise<void> {
    await this.enqueue({ kind: 'korrekturen', versionId }, `korrekturen:${versionId}`, delayMs);
  }

  async kundenmaterial(projectId: string, delayMs: number): Promise<void> {
    await this.enqueue({ kind: 'kundenmaterial', projectId }, `kundenmaterial:${projectId}`, delayMs);
  }

  async erstbesuch(userId: string, shareLinkId: string): Promise<void> {
    await this.enqueue(
      { kind: 'erstbesuch', userId, shareLinkId },
      `erstbesuch:${userId}:${shareLinkId}`,
    );
  }

  async fassungVerfuegbar(versionId: string): Promise<void> {
    await this.enqueue({ kind: 'fassung-verfuegbar', versionId }, `fassung:${versionId}`);
  }

  async endfassung(versionId: string): Promise<void> {
    await this.enqueue({ kind: 'endfassung', versionId }, `endfassung:${versionId}`);
  }

  async projekteAbholen(): Promise<void> {
    await this.enqueue({ kind: 'projekte-abholen' }, 'projekte-abholen');
  }
}
