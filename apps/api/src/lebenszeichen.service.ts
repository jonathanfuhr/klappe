import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import IORedis from 'ioredis';
import { AppConfig, CONFIG } from './config/configuration';
import { DB, type Database } from './db/db.module';

/**
 * Beweist im Takt, dass der Worker nicht nur läuft, sondern **arbeitet**.
 *
 * Der Anlass war ein Ausfall am 18.08.2026, der einen Tag lang niemandem
 * auffiel: Postgres und Redis wurden ohne ihre Host-Ports neu erzeugt, der
 * native Worker verlor beide Verbindungen – und blieb als Prozess bestehen.
 * `launchctl` meldete brav `state = running`, das Deploy-Skript hätte
 * „Worker läuft" gesagt, und beides stimmte sogar. Er hatte nur seit
 * vierundzwanzig Stunden keine einzige Verbindung mehr und nahm keinen
 * Auftrag an. Ein Upload blieb bei 0 % stehen, ohne Fehler, ohne Meldung.
 *
 * Die Lehre: **„Der Prozess lebt" ist keine brauchbare Auskunft.** Ein
 * Aufpasser, der nur das prüft, ist genau dann zufrieden, wenn es am meisten
 * darauf ankäme.
 *
 * Deshalb hier ein echter Griff an beide Abhängigkeiten. Klappt er dreimal
 * hintereinander nicht, beendet sich der Prozess mit einem Fehler – und
 * launchd startet ihn neu. Ist die Ursache noch da, läuft er in eine sichtbare
 * Neustartschleife: `runs` klettert, das Protokoll füllt sich. Das ist
 * unangenehm, und genau das soll es sein. Ein stiller Ausfall ist schlimmer
 * als ein lauter.
 */
@Injectable()
export class LebenszeichenService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LebenszeichenService.name);
  private redis: IORedis | null = null;
  private takt: NodeJS.Timeout | null = null;
  private fehlschlaege = 0;

  /** Abstand zwischen zwei Proben. */
  private static readonly TAKT_MS = 30_000;

  /**
   * So oft darf es hintereinander schiefgehen, bevor der Prozess aufgibt.
   * Drei mal dreißig Sekunden: lang genug, um einen Neustart von Postgres zu
   * überstehen, kurz genug, dass niemand einen halben Tag ins Leere lädt.
   */
  private static readonly GEDULD = 3;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DB) private readonly db: Database,
  ) {}

  onModuleInit(): void {
    // Eigene Verbindung, ausdrücklich mit begrenzten Versuchen: Die Verbindung
    // der Warteschlange läuft mit `maxRetriesPerRequest: null` und wartet
    // deshalb ewig – zum Prüfen taugt sie nicht, sie würde nie „nein" sagen.
    this.redis = new IORedis(this.config.redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    // Ohne Zuhörer wirft ioredis den Verbindungsfehler als unbehandeltes
    // Ereignis und reißt den Prozess an einer anderen Stelle mit.
    this.redis.on('error', () => undefined);

    this.takt = setInterval(() => void this.pruefe(), LebenszeichenService.TAKT_MS);
    // Nicht erst nach dem ersten Takt: Startet der Worker in eine kaputte
    // Umgebung hinein, soll das sofort auffallen und nicht in einer halben
    // Minute.
    setTimeout(() => void this.pruefe(), 5_000);
  }

  onModuleDestroy(): void {
    if (this.takt) clearInterval(this.takt);
    this.redis?.disconnect();
  }

  private async pruefe(): Promise<void> {
    try {
      // Beides, und beides echt: Ein `PING` beweist Redis, eine Abfrage die
      // Datenbank. Der Worker braucht sie zusammen – eine allein zu prüfen
      // hieße, die Hälfte der Ausfälle zu übersehen.
      await this.redis?.ping();
      await this.db.execute(sql`select 1`);

      if (this.fehlschlaege > 0) {
        this.logger.log(`Verbindungen wieder da (nach ${this.fehlschlaege} Fehlversuchen).`);
      }
      this.fehlschlaege = 0;
      await this.vermerkeLebenszeichen();
    } catch (fehler) {
      this.fehlschlaege += 1;
      this.logger.error(
        `Lebenszeichen ${this.fehlschlaege}/${LebenszeichenService.GEDULD} fehlgeschlagen: ${String(fehler)}`,
      );

      if (this.fehlschlaege >= LebenszeichenService.GEDULD) {
        this.logger.error(
          'Keine Verbindung zu Redis oder Datenbank. Der Worker beendet sich, damit ' +
            'der Dienst ihn neu startet – weiterzulaufen hieße, still nichts zu tun.',
        );
        // Kein `app.close()`: Das wartet auf Verbindungen, die es nicht mehr
        // gibt, und hinge dann genau so fest wie der Prozess, den es zu
        // ersetzen gilt.
        process.exit(1);
      }
    }
  }

  /**
   * Wann zuletzt alles stand – als Datei, nicht in Redis.
   *
   * Ein Lebenszeichen, das in dem Dienst liegt, dessen Ausfall es melden soll,
   * wäre keines. Die Datei lässt sich von außen ansehen, ohne irgendetwas
   * anzuwerfen: `cat` genügt.
   */
  private async vermerkeLebenszeichen(): Promise<void> {
    try {
      await writeFile(
        `${this.config.storage.root}/worker-lebenszeichen`,
        `${new Date().toISOString()}\n`,
        'utf8',
      );
    } catch {
      // Der Vermerk ist Beiwerk. Klemmt das Dateisystem, ist das ein eigenes
      // Problem – aber kein Grund, einen arbeitsfähigen Worker abzuschießen.
    }
  }
}
