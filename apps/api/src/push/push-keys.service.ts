/**
 * Das VAPID-Schlüsselpaar (Phase 29).
 *
 * VAPID ist der Ausweis dieses Servers gegenüber Apple, Google und Mozilla:
 * Der Browser merkt sich beim Anmelden den öffentlichen Schlüssel, und der
 * Push-Dienst nimmt später nur Sendungen an, die mit dem passenden privaten
 * Schlüssel unterschrieben sind. Es hält niemanden ab, der die Endpunkte
 * kennt – es sagt nur, dass sie alle vom selben Absender stammen.
 *
 * Das Paar liegt in der Datenbank und nicht in der `.env`. Der Grund ist
 * nicht Bequemlichkeit: Ein neues Paar macht **jedes** bestehende Abo
 * ungültig, denn der alte öffentliche Schlüssel steckt in jedem einzelnen
 * davon. In der `.env` ginge es beim Neuaufsetzen eines Containers verloren,
 * und sämtliche Geräte wären still abgemeldet, ohne dass jemand etwas
 * bemerkt – bis auffällt, dass nichts mehr ankommt.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import webpush from 'web-push';
import { AppConfig, CONFIG } from '../config/configuration';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { DB, type Database } from '../db/db.module';
import { appSettings } from '../db/schema';
import { SETTINGS_ID, SettingsService } from '../settings/settings.service';

export interface VapidPaar {
  publicKey: string;
  privateKey: string;
}

@Injectable()
export class PushKeysService {
  private readonly logger = new Logger(PushKeysService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Das Paar, beim ersten Bedarf erzeugt.
   *
   * Geschrieben wird nur, solange die Spalte leer ist – als Bedingung im
   * `UPDATE` selbst, nicht als Blick davor. API und Worker starten
   * gleichzeitig; ohne das erzeugten beide ein Paar, das zweite überschriebe
   * das erste, und die Hälfte der Abos liefe fortan gegen einen Schlüssel,
   * den es nicht mehr gibt. Wer das Rennen verliert, liest einfach nach.
   */
  async ensure(): Promise<VapidPaar> {
    const vorhanden = await this.read();
    if (vorhanden) return vorhanden;

    const erzeugt = webpush.generateVAPIDKeys();
    const [zeile] = await this.db
      .update(appSettings)
      .set({
        vapidPublicKey: erzeugt.publicKey,
        vapidPrivateKeyEncrypted: encryptSecret(erzeugt.privateKey, this.config.jwt.secret),
      })
      .where(and(eq(appSettings.id, SETTINGS_ID), isNull(appSettings.vapidPublicKey)))
      .returning({ publicKey: appSettings.vapidPublicKey });

    if (zeile?.publicKey === erzeugt.publicKey) {
      this.logger.log('VAPID-Schlüsselpaar erzeugt – Push-Benachrichtigungen sind einsatzbereit.');
      return erzeugt;
    }

    const nachgelesen = await this.read();
    if (nachgelesen) return nachgelesen;
    // Kann nur passieren, wenn das Schreiben scheiterte und danach immer noch
    // nichts dasteht – dann lieber laut als mit einem halben Schlüssel weiter.
    throw new Error('VAPID-Schlüsselpaar konnte weder erzeugt noch gelesen werden.');
  }

  /** Nur der öffentliche Teil, für die Anmeldung im Browser. */
  async publicKey(): Promise<string> {
    return (await this.ensure()).publicKey;
  }

  /**
   * Das abgelegte Paar, sofern es eines gibt **und** es sich entschlüsseln
   * lässt. Ein gewechseltes `JWT_SECRET` macht den privaten Teil unlesbar –
   * das ist derselbe Preis wie beim SMTP-Passwort, nur mit anderer Folge:
   * Hier gilt das Paar dann als nicht vorhanden, und es wird ein neues
   * erzeugt. Die alten Abos sind ohnehin verloren.
   */
  private async read(): Promise<VapidPaar | null> {
    const row = await this.settings.getRow();
    if (!row?.vapidPublicKey) return null;
    const privateKey = decryptSecret(row.vapidPrivateKeyEncrypted, this.config.jwt.secret);
    if (!privateKey) {
      this.logger.warn(
        'Der private VAPID-Schlüssel lässt sich nicht entschlüsseln – vermutlich wurde ' +
          'JWT_SECRET gewechselt. Es wird ein neues Paar erzeugt; angemeldete Geräte ' +
          'müssen sich neu anmelden.',
      );
      // Die tote Hälfte wegräumen, sonst greift die Bedingung im `UPDATE`
      // oben nie und es entstünde nie wieder ein brauchbares Paar.
      await this.db
        .update(appSettings)
        .set({ vapidPublicKey: null, vapidPrivateKeyEncrypted: null })
        .where(eq(appSettings.id, SETTINGS_ID));
      return null;
    }
    return { publicKey: row.vapidPublicKey, privateKey };
  }
}
