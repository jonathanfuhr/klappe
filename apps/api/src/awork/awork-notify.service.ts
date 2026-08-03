/**
 * Der Auslöser für alles, was nach awork geht (Phase 30).
 *
 * Diese Fassade steht bewusst vor der Warteschlange: Die aufrufenden Dienste –
 * Kommentare, Uploads, Fassungen – sollen einen Einzeiler schreiben und nichts
 * über awork wissen müssen. Ob die Anbindung überhaupt läuft, ob das Ereignis
 * eingeschaltet ist und wie lange gesammelt wird, wird hier entschieden.
 *
 * Kein Aufruf hier wirft. Ein Kommentar ist gespeichert, auch wenn awork
 * gerade nicht erreichbar ist – dieselbe Haltung wie beim Mailversand.
 */
import { Injectable, Logger } from '@nestjs/common';
import { AworkQueueService } from '../queue/awork-queue.service';
import { SettingsService } from '../settings/settings.service';
import { AworkSettingsService } from './awork-settings.service';

@Injectable()
export class AworkNotifyService {
  private readonly logger = new Logger(AworkNotifyService.name);

  constructor(
    private readonly settings: AworkSettingsService,
    private readonly appSettings: SettingsService,
    private readonly queue: AworkQueueService,
  ) {}

  /**
   * An einer Fassung hat sich etwas getan: neuer Kommentar, geänderter,
   * gelöschter oder abgehakter. In allen Fällen dasselbe – die Beschreibung in
   * awork entsteht ohnehin komplett neu, es zählt nur, dass überhaupt
   * nachgesehen wird.
   *
   * Gesammelt wird mit der Ruhezeit der Sammelmail: Wer sein Postfach im
   * Fünf-Minuten-Takt bekommt, will die Aufgabe nicht im Sekundentakt
   * aktualisiert sehen.
   */
  async kommentarGeaendert(versionId: string): Promise<void> {
    await this.sicher('korrekturen', async () => {
      if (!(await this.settings.isReady())) return;
      const minuten = await this.appSettings.digestMinutes();
      await this.queue.korrekturen(versionId, minuten * 60_000);
    });
  }

  async kundenmaterial(projectId: string, delayMs: number): Promise<void> {
    await this.sicher('kundenmaterial', async () => {
      if (!(await this.settings.isReady())) return;
      if (!(await this.settings.eventEnabled('kundenmaterial'))) return;
      await this.queue.kundenmaterial(projectId, delayMs);
    });
  }

  async erstbesuch(userId: string, shareLinkId: string): Promise<void> {
    await this.sicher('erstbesuch', async () => {
      if (!(await this.settings.isReady())) return;
      if (!(await this.settings.eventEnabled('erstbesuch'))) return;
      await this.queue.erstbesuch(userId, shareLinkId);
    });
  }

  /**
   * Eine Fassung ist beim Kunden angekommen. Wird von zwei Stellen gerufen –
   * beim Fertigwerden und beim nachträglichen Freigeben –, weil beides
   * derselbe Moment für den Kunden ist. Dass daraus nur **eine** Meldung wird,
   * regelt der Vermerk in `awork_notices`.
   */
  async fassungVerfuegbar(versionId: string): Promise<void> {
    await this.sicher('fassung-verfuegbar', async () => {
      if (!(await this.settings.isReady())) return;
      if (!(await this.settings.eventEnabled('fassung-verfuegbar'))) return;
      await this.queue.fassungVerfuegbar(versionId);
    });
  }

  async endfassung(versionId: string): Promise<void> {
    await this.sicher('endfassung', async () => {
      if (!(await this.settings.isReady())) return;
      if (!(await this.settings.eventEnabled('endfassung'))) return;
      await this.queue.endfassung(versionId);
    });
  }

  private async sicher(was: string, arbeit: () => Promise<void>): Promise<void> {
    try {
      await arbeit();
    } catch (error) {
      this.logger.error(`awork-Meldung „${was}" nicht eingereiht: ${String(error)}`);
    }
  }
}
