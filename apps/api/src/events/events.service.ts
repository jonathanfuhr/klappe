import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import { Subject } from 'rxjs';
import { AppConfig, CONFIG } from '../config/configuration';

/**
 * Was sich geändert hat – bewusst ohne Inhalt.
 *
 * Der Strom sagt nur „hier ist etwas passiert“; die Oberfläche holt sich die
 * Daten danach über die gewohnten Wege. Das ist der Punkt: Die Rechteprüfung
 * bleibt an genau einer Stelle, statt sich in einen zweiten Kanal zu
 * verzweigen, den man leicht zu vergessen absichern vergisst.
 */
export interface KlappeEvent {
  topic: 'video' | 'project' | 'notification';
  /** Video-, Projekt- oder Benutzerkennung, je nach `topic`. */
  id: string;
  /** Projekt zum Video – entscheidet, wer den Hinweis überhaupt bekommt. */
  projectId?: string;
  /** Nur bei `notification`: Für wen der Hinweis bestimmt ist. */
  userId?: string;
}

const CHANNEL = 'klappe:events';

/**
 * Live-Aktualisierung statt regelmäßigem Nachladen (Phase 18, Zusatz).
 *
 * Zwei Prozesse erzeugen Ereignisse: die API (Kommentare, Freigaben) und der
 * Worker (Verarbeitung). Angeschlossen sind die Browser aber nur an der API.
 * Deshalb läuft alles über Redis – das steht ohnehin für die Warteschlangen
 * bereit und erspart einen weiteren Baustein.
 *
 * Der Weg hinaus ist SSE (`EventSource`) und nicht WebSocket: Er ist
 * einseitig – mehr braucht es hier nicht –, kommt durch jeden Reverse-Proxy
 * und baut sich nach einem Abriss von selbst wieder auf.
 */
@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly logger = new Logger(EventsService.name);
  private readonly stream = new Subject<KlappeEvent>();
  private readonly publisher: IORedis;
  private readonly subscriber: IORedis;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.publisher = new IORedis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
    this.subscriber = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });

    // Ohne Redis läuft alles weiter, nur eben ohne Live-Aktualisierung: Die
    // Oberfläche lädt dann im langsamen Takt nach, wie vorher.
    void this.publisher.connect().catch((error) => {
      this.logger.warn(`Ereignis-Kanal ohne Verbindung: ${String(error)}`);
    });
    void this.subscriber
      .connect()
      .then(() => this.subscriber.subscribe(CHANNEL))
      .then(() => {
        this.subscriber.on('message', (_channel, payload) => {
          try {
            this.stream.next(JSON.parse(payload) as KlappeEvent);
          } catch {
            // Fremde Nachricht im Kanal – ignorieren statt abstürzen.
          }
        });
      })
      .catch((error) => this.logger.warn(`Ereignis-Kanal ohne Verbindung: ${String(error)}`));
  }

  onModuleDestroy(): void {
    this.stream.complete();
    this.publisher.disconnect();
    this.subscriber.disconnect();
  }

  /**
   * Meldet eine Änderung. Absichtlich ohne `await` beim Aufrufer verwendbar
   * und ohne Fehlerweitergabe: Ein Kommentar ist gespeichert, auch wenn der
   * Hinweis darüber nicht rausgeht.
   */
  publish(event: KlappeEvent): void {
    void this.publisher.publish(CHANNEL, JSON.stringify(event)).catch((error) => {
      this.logger.warn(`Ereignis nicht zustellbar: ${String(error)}`);
    });
  }

  /** Der gemeinsame Strom – der Controller filtert daraus je Zuhörer. */
  events(): Subject<KlappeEvent> {
    return this.stream;
  }
}
