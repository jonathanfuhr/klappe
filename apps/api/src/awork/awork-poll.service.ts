/**
 * Der Taktgeber für die Gegenrichtung (Phase 30).
 *
 * awork kann zwar Webhooks, die brauchen aber eine aus dem Internet
 * erreichbare Klappe-Instanz – und abgesichert wären sie nur über einen
 * mitgeschickten Header, denn awork signiert nicht. Abholen läuft dagegen
 * überall: hinter einem Tunnel, im LAN, über Tailscale. Bei 1000 erlaubten
 * Anfragen je Minute kostet ein Blick alle paar Minuten nichts.
 *
 * Wie beim Aufräumen ein schlichtes `setInterval` statt einer Cron-Bibliothek:
 * Der Worker läuft durch, und der genaue Zeitpunkt spielt keine Rolle.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AworkQueueService } from '../queue/awork-queue.service';
import { AworkSettingsService } from './awork-settings.service';

/** Alle fünf Minuten nachsehen. */
const INTERVAL_MS = 5 * 60 * 1000;
/**
 * Beim Start nicht sofort: Erst sollen Datenbank und Warteschlange stehen.
 * Eine Minute ist genug und fällt niemandem auf.
 */
const FIRST_RUN_DELAY_MS = 60 * 1000;

@Injectable()
export class AworkPollService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AworkPollService.name);
  private timer: NodeJS.Timeout | null = null;
  private erstlauf: NodeJS.Timeout | null = null;

  constructor(
    private readonly settings: AworkSettingsService,
    private readonly queue: AworkQueueService,
  ) {}

  onModuleInit(): void {
    this.erstlauf = setTimeout(() => void this.anstossen(), FIRST_RUN_DELAY_MS);
    this.erstlauf.unref();
    this.timer = setInterval(() => void this.anstossen(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.erstlauf) clearTimeout(this.erstlauf);
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Reiht den Abhol-Auftrag ein, statt selbst zu arbeiten.
   *
   * So läuft die Abholung durch dieselbe Warteschlange wie alles andere –
   * einer nach dem anderen, mit denselben Wiederholungen. Und sie kann sich
   * nicht mit einem noch laufenden Durchgang überschneiden: Die feste
   * Auftragskennung sorgt dafür, dass ein wartender Auftrag genügt.
   */
  private async anstossen(): Promise<void> {
    try {
      if (!(await this.settings.isReady())) return;
      const { autoCreateProjects, writeBackLink, syncProjectNumber } =
        await this.settings.syncConfig();
      // Ist keine der drei Aufgaben eingeschaltet, gibt es nichts abzuholen.
      if (!autoCreateProjects && !writeBackLink && !syncProjectNumber) return;

      await this.queue.projekteAbholen();
    } catch (error) {
      this.logger.error(`awork-Abholung nicht angestoßen: ${String(error)}`);
    }
  }
}
