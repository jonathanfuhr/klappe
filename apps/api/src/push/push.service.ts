/**
 * Push-Benachrichtigungen an angemeldete Geräte (Phase 29).
 *
 * Ein Abo ist ein Browser auf einem Gerät, nicht eine Person – wer am Mac und
 * am Handy zusagt, bekommt beides. Die Nutzlast wird von `web-push` mit den
 * Schlüsseln des Browsers verschlüsselt, bevor sie hinausgeht: Apple, Google
 * und Mozilla stellen zu, sehen aber nur, **dass** etwas kam.
 *
 * Sie enthält trotzdem bewusst wenig – Kunde, Projekt, Video und wie viel
 * neu ist. Kein Autorenname, kein Kommentartext. Das ist keine Sparsamkeit
 * beim Verschlüsseln, sondern eine Entscheidung darüber, was auf einem
 * fremden Sperrbildschirm lesbar sein soll.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import webpush from 'web-push';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { pushSubscriptions } from '../db/schema';
import { PushKeysService } from './push-keys.service';

/** Was auf dem Sperrbildschirm landet. Der Service Worker baut daraus die Kachel. */
export interface PushNutzlast {
  /** Die Art der Sache: „Neuer Kommentar", „Neue Erwähnung". */
  title: string;
  /** Wo: Kunde · Projekt · Video, davor die Zahl, wenn mehr als eines wartet. */
  body: string;
  /**
   * Die Klammer, unter der der Browser zusammenfasst. Gleicher `tag` heisst:
   * Die vorhandene Kachel wird fortgeschrieben statt eine zweite gestapelt –
   * es brummt einmal, danach zählt sie still hoch.
   */
  tag: string;
  /** Wohin der Klick führt, als Pfad ohne Herkunft. */
  url: string;
}

export interface PushAboEingang {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

/**
 * Wie lange der Push-Dienst eine Sendung aufhebt, wenn das Gerät offline ist.
 * Vier Stunden: Ein Kommentar von heute früh ist am Abend keine Meldung mehr
 * wert, und die Zentrale hat ihn ohnehin.
 */
const TTL_SEKUNDEN = 4 * 60 * 60;

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly keys: PushKeysService,
  ) {}

  /**
   * Ein Gerät anmelden. Meldet sich derselbe Browser erneut – nach einem
   * Neuladen etwa –, wird die vorhandene Zeile aufgefrischt statt eine
   * zweite angelegt: Der Endpunkt ist von sich aus eindeutig.
   *
   * Wechselt dabei der Besitzer, geht die Zeile mit. Das ist der Fall
   * „zwei Personen an einem Rechner": Wer sich zuletzt angemeldet hat,
   * bekommt die Meldungen, und die vorige Person nicht mehr.
   */
  async subscribe(userId: string, eingang: PushAboEingang): Promise<void> {
    await this.db
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint: eingang.endpoint,
        p256dh: eingang.p256dh,
        auth: eingang.auth,
        userAgent: eingang.userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId,
          p256dh: eingang.p256dh,
          auth: eingang.auth,
          userAgent: eingang.userAgent ?? null,
        },
      });
  }

  /**
   * Ein Gerät abmelden. Ohne Bindung an die Person: Wer den Endpunkt nennt,
   * hat ihn vom eigenen Browser – und ein Abo, das jemand loswerden will,
   * soll auch dann verschwinden, wenn es noch am vorigen Konto hängt.
   */
  async unsubscribe(endpoint: string): Promise<void> {
    await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  /** Ist dieser Browser angemeldet? Für die Zeile in der Zentrale. */
  async isSubscribed(userId: string, endpoint: string): Promise<boolean> {
    const [zeile] = await this.db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)),
      )
      .limit(1);
    return Boolean(zeile);
  }

  /**
   * An alle Geräte einer Person senden. Gibt zurück, wie viele erreicht
   * wurden – 0 heisst schlicht: kein Gerät angemeldet, kein Fehler.
   *
   * Ein Fehlschlag darf nie den Aufrufer aufhalten: Push ist die Beigabe zur
   * Benachrichtigungszentrale, nicht ihr Ersatz. Der Eintrag steht ohnehin
   * schon, wenn wir hier ankommen.
   */
  async sendToUser(userId: string, nutzlast: PushNutzlast): Promise<number> {
    const abos = await this.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    if (abos.length === 0) return 0;

    const paar = await this.keys.ensure();
    const koerper = JSON.stringify(nutzlast);
    let zugestellt = 0;

    for (const abo of abos) {
      try {
        await webpush.sendNotification(
          {
            endpoint: abo.endpoint,
            keys: { p256dh: abo.p256dh, auth: abo.auth },
          },
          koerper,
          {
            TTL: TTL_SEKUNDEN,
            vapidDetails: {
              // Die Kennung des Absenders. Push-Dienste wollen eine Adresse,
              // an der sie sich melden könnten; die öffentliche URL erfüllt
              // das und verrät nichts, was nicht ohnehin bekannt ist.
              subject: this.config.publicUrl,
              publicKey: paar.publicKey,
              privateKey: paar.privateKey,
            },
          },
        );
        zugestellt += 1;
        await this.db
          .update(pushSubscriptions)
          .set({ lastSuccessAt: new Date() })
          .where(eq(pushSubscriptions.id, abo.id));
      } catch (error) {
        await this.behandleFehler(abo.id, abo.endpoint, error);
      }
    }

    return zugestellt;
  }

  /**
   * 404 und 410 sind keine Störung, sondern die Auskunft des Push-Dienstes,
   * dass es dieses Abo nicht mehr gibt – der Browser wurde zurückgesetzt,
   * die App entfernt, die Erlaubnis entzogen. Dann fliegt die Zeile, sonst
   * scheitert sie bei jeder weiteren Meldung erneut.
   *
   * Alles andere bleibt stehen: Ein 500 beim Dienst oder ein Netzhänger ist
   * vorübergehend, und ein Abo dafür wegzuwerfen hiesse, jemanden wegen
   * einer Störung stillschweigend abzumelden.
   */
  private async behandleFehler(id: string, endpoint: string, error: unknown): Promise<void> {
    const status = (error as { statusCode?: number } | null)?.statusCode;
    if (status === 404 || status === 410) {
      await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
      this.logger.log(`Abgelaufenes Push-Abo entfernt (${status}).`);
      return;
    }
    this.logger.warn(
      `Push an ${endpoint.slice(0, 60)}… fehlgeschlagen${status ? ` (${status})` : ''}: ${String(error)}`,
    );
  }
}
