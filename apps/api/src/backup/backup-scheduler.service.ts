/**
 * Der Zeitplan hinter der Datenbanksicherung (Phase 23).
 *
 * Bewusst nur im Worker: Zwei Prozesse, die denselben Dump ziehen, schrieben
 * zwei Dateien und stritten sich um dieselbe Zeile. Die API bedient nur die
 * Einstellungen und den „Jetzt sichern"-Knopf.
 *
 * Wie beim Aufräumer ein schlichter Timer statt eines Scheduler-Pakets – ein
 * Prozess, eine Aufgabe. Der Takt ist eng (viertelstündlich), die Entscheidung
 * fällt aber am gespeicherten Zeitpunkt des letzten Laufs: So wirkt eine
 * geänderte Einstellung zeitnah, ohne dass ein Neustart nötig wäre, und ein
 * Neustart des Containers löst keinen zusätzlichen Lauf aus.
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MailQueueService } from '../queue/mail-queue.service';
import { BackupService } from './backup.service';

/** So oft wird nachgesehen, ob etwas fällig ist. */
const TAKT_MS = 15 * 60 * 1000;
/** Nach dem Start erst einmal ankommen lassen. */
const ERSTLAUF_MS = 2 * 60 * 1000;

@Injectable()
export class BackupSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private erstlauf: NodeJS.Timeout | null = null;

  constructor(
    private readonly backup: BackupService,
    private readonly mailQueue: MailQueueService,
  ) {}

  onModuleInit(): void {
    this.erstlauf = setTimeout(() => void this.pruefe(), ERSTLAUF_MS);
    this.erstlauf.unref();

    this.timer = setInterval(() => void this.pruefe(), TAKT_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.erstlauf) clearTimeout(this.erstlauf);
    if (this.timer) clearInterval(this.timer);
  }

  private async pruefe(): Promise<void> {
    try {
      const faellig = await this.backup.naechsterLauf();
      if (!faellig || faellig.getTime() > Date.now()) return;

      if (!(await this.backup.werkzeugeVorhanden())) {
        // Nur einmal je Takt ins Protokoll, nicht als Ausnahme: Ein Container
        // ohne pg_dump ist ein Einrichtungsfehler, kein Absturzgrund.
        this.logger.warn('Sicherung übersprungen – pg_dump fehlt in diesem Container.');
        return;
      }

      await this.backup.run();
      const entfernt = await this.backup.cleanup();
      if (entfernt > 0) this.logger.log(`${entfernt} alte Sicherung(en) entfernt.`);
    } catch (error) {
      // Der Grund steht bereits in den Einstellungen und im Protokoll des
      // Dienstes; hier soll nur der Timer weiterlaufen.
      this.logger.error(`Geplante Sicherung fehlgeschlagen: ${String(error)}`);
      // Und seit Phase 28 erfahren es die Administratoren: Eine Sicherung, von
      // der niemand weiß, dass sie nicht läuft, ist keine.
      await this.mailQueue
        .enqueue({
          kind: 'backup-failed',
          reason: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        })
        .catch(() => undefined);
    }
  }
}
