/**
 * Gerätekopplung: ein Plugin mit einem Konto verbinden (Phase 27).
 *
 * Der Ablauf ist der eines Fernsehers, den man mit einem Streamingdienst
 * verbindet – und aus demselben Grund so gebaut: Auf dem Gerät soll kein
 * Passwort eingetippt werden.
 *
 * ```
 *  Plugin                          Mensch im Browser                Server
 *    │  1. starten ─────────────────────────────────────────────────►│
 *    │◄──── Gerätecode (geheim) + Benutzercode (KHFP-3RTM) ──────────│
 *    │                                                               │
 *    │  2. zeigt „KHFP-3RTM“ und die Adresse an                      │
 *    │                          ├── öffnet /geraet, ist angemeldet ─►│
 *    │                          ├── sieht, wer sich verbinden will   │
 *    │                          └── bestätigt ───────────────────────►│
 *    │                                                    Token entsteht
 *    │  3. fragt nach ──────────────────────────────────────────────►│
 *    │◄──── Token (genau einmal) ────────────────────────────────────│
 * ```
 *
 * Warum das sicherer ist als ein Anmeldeformular im Plugin: Das Passwort
 * verlässt den Browser nie, Microsoft 365 funktioniert unverändert mit
 * (der Mensch ist dort ja längst angemeldet), und die Bestätigung kann auf
 * einem ganz anderen Gerät stattfinden als der Schnittplatz.
 *
 * Zwei Geheimnisse, zwei Aufgaben: Der **Benutzercode** ist kurz und benennt
 * nur eine wartende Anfrage – er schaltet nichts frei. Den Token bekommt allein,
 * wer den langen **Gerätecode** vorzeigt, und der hat das Plugin nie verlassen.
 */
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { DevicePendingDto, DeviceStartDto, DeviceTokenDto } from '@klappe/shared';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { type DeviceAuthorizationRow, deviceAuthorizations, users } from '../db/schema';
import { ApiTokensService } from './api-tokens.service';
import { createDeviceCode, createUserCode, hashDeviceCode, normalizeUserCode } from './device-code';

/**
 * Wie lange eine angefangene Kopplung gilt. Zehn Minuten reichen, um vom
 * Schnittplatz zum Browser zu wechseln und sich notfalls erst anzumelden –
 * und sind kurz genug, dass ein liegengebliebener Code nichts wert ist.
 */
const AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

/** Was das Plugin zwischen zwei Nachfragen warten soll, in Sekunden. */
const POLL_INTERVAL_SECONDS = 5;

/**
 * So oft darf eine Kopplung erfolglos abgefragt werden. Bei 5 Sekunden Takt
 * sind 200 Versuche mehr als die Laufzeit hergibt – die Grenze trifft also nur
 * jemanden, der schneller fragt als vereinbart.
 */
const MAX_POLL_ATTEMPTS = 200;

/** Wie ein Gerät sich nennt, wenn es nichts sagt. */
const DEFAULT_CLIENT_NAME = 'Unbenanntes Gerät';

@Injectable()
export class DeviceFlowService {
  private readonly logger = new Logger(DeviceFlowService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly apiTokens: ApiTokensService,
  ) {}

  /**
   * Schritt 1: Das Plugin meldet eine Kopplung an.
   *
   * Ohne freigeschalteten API-Zugriff endet es hier – und zwar mit einer
   * klaren Ansage. Das ist die eine Stelle, an der eine deutliche Fehlermeldung
   * richtig ist: Wer hier steht, hat kein Geheimnis geraten, sondern ein
   * Plugin gestartet, und soll erfahren, dass sein Administrator die Tür
   * geschlossen hat.
   */
  async start(clientName: string | undefined): Promise<DeviceStartDto> {
    if (!(await this.apiTokens.isApiAccessEnabled())) {
      throw new ForbiddenException(
        'Der externe API-Zugriff ist für diesen Workspace abgeschaltet. Ein Administrator kann ihn in den Einstellungen unter „API-Zugriff" freigeben.',
      );
    }

    const deviceCode = createDeviceCode();
    const userCode = await this.freierBenutzercode();
    const expiresAt = new Date(Date.now() + AUTHORIZATION_TTL_MS);

    await this.db.insert(deviceAuthorizations).values({
      deviceCodeHash: hashDeviceCode(deviceCode),
      userCode,
      clientName: sauberName(clientName),
      expiresAt,
    });

    const basis = this.config.publicUrl.replace(/\/+$/, '');
    return {
      deviceCode,
      userCode,
      verificationUrl: `${basis}/geraet`,
      // Mit Code in der Adresse: Wer den Link anklicken kann, muss nichts
      // abtippen. Der lange Weg über das Eingabefeld bleibt trotzdem, denn
      // oft steht der Schnittplatz woanders als der Browser.
      verificationUrlComplete: `${basis}/geraet?code=${encodeURIComponent(userCode)}`,
      expiresInSeconds: Math.floor(AUTHORIZATION_TTL_MS / 1000),
      intervalSeconds: POLL_INTERVAL_SECONDS,
    };
  }

  /**
   * Was der Mensch im Browser sieht, bevor er bestätigt: Wer will sich hier
   * eigentlich verbinden? Ohne diese Auskunft wäre die Bestätigung ein
   * Blankoscheck.
   */
  async describe(userCode: string): Promise<DevicePendingDto> {
    const row = await this.findePending(userCode);
    return {
      userCode: row.userCode,
      clientName: row.clientName,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /**
   * Schritt 2: Der angemeldete Mensch bestätigt. Erst hier entsteht der Token –
   * und er wandert verschlüsselt in die Zeile, bis das Plugin ihn abholt.
   *
   * Gäste dürfen das auch: Ihr Token trägt genau ihre Freigaben, nicht mehr.
   * Ein Kunde, der seine Anmerkungen aus Klappe in sein eigenes Werkzeug
   * holen will, ist kein Sonderfall, den man verbieten müsste.
   */
  async approve(userCode: string, user: { id: string; name: string }): Promise<DevicePendingDto> {
    if (!(await this.apiTokens.isApiAccessEnabled())) {
      throw new ForbiddenException('Der externe API-Zugriff ist abgeschaltet.');
    }

    const row = await this.findePending(userCode);

    const { token, plaintext } = await this.apiTokens.issue({
      userId: user.id,
      name: row.clientName,
      origin: 'device',
    });

    await this.db
      .update(deviceAuthorizations)
      .set({
        userId: user.id,
        approvedAt: new Date(),
        apiTokenId: token.id,
        tokenEncrypted: encryptSecret(plaintext, this.config.jwt.secret),
      })
      .where(eq(deviceAuthorizations.id, row.id));

    this.logger.log(`Gerät verbunden: ${row.clientName} mit dem Konto von ${user.name}.`);
    return {
      userCode: row.userCode,
      clientName: row.clientName,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /**
   * Abgelehnt. Das Plugin bekommt daraufhin eine Absage statt zehn Minuten
   * Warten – wer sich vertippt hat, soll das sofort merken.
   */
  async deny(userCode: string): Promise<void> {
    const row = await this.findePending(userCode);
    await this.db
      .update(deviceAuthorizations)
      .set({ deniedAt: new Date() })
      .where(eq(deviceAuthorizations.id, row.id));
  }

  /**
   * Schritt 3: Das Plugin holt seinen Token ab.
   *
   * `null` heißt „noch nichts entschieden, frag später noch mal“. Alles
   * andere – abgelehnt, abgelaufen, zu oft gefragt – ist ein Fehler, damit das
   * Plugin aufhören kann zu fragen.
   */
  async redeem(deviceCode: string): Promise<DeviceTokenDto | null> {
    if (!(await this.apiTokens.isApiAccessEnabled())) {
      throw new ForbiddenException('Der externe API-Zugriff ist abgeschaltet.');
    }

    const [row] = await this.db
      .select()
      .from(deviceAuthorizations)
      .where(eq(deviceAuthorizations.deviceCodeHash, hashDeviceCode(deviceCode)))
      .limit(1);

    if (!row) throw new NotFoundException('Diese Kopplung gibt es nicht.');
    if (row.deniedAt) throw new ForbiddenException('Die Verbindung wurde abgelehnt.');
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Die Kopplung ist abgelaufen. Bitte neu starten.');
    }

    // Noch niemand am Zug: Der Zähler steigt, damit ein Plugin, das schneller
    // fragt als vereinbart, irgendwann anstößt.
    if (!row.approvedAt || !row.tokenEncrypted) {
      const versuche = row.attempts + 1;
      await this.db
        .update(deviceAuthorizations)
        .set({ attempts: versuche })
        .where(eq(deviceAuthorizations.id, row.id));

      if (versuche > MAX_POLL_ATTEMPTS) {
        throw new BadRequestException('Zu viele Abfragen. Bitte die Kopplung neu starten.');
      }
      return null;
    }

    const plaintext = decryptSecret(row.tokenEncrypted, this.config.jwt.secret);
    if (!plaintext) {
      // Praktisch nur erreichbar, wenn JWT_SECRET zwischen Bestätigung und
      // Abholung gewechselt hat. Dann ist der Token unbrauchbar – neu koppeln.
      this.logger.error('Der hinterlegte Token ließ sich nicht entschlüsseln. Wurde JWT_SECRET geändert?');
      throw new BadRequestException('Die Kopplung ist ungültig geworden. Bitte neu starten.');
    }

    // Genau einmal: Mit dem Abholen verschwindet der Klartext aus der
    // Datenbank. Ein zweiter Versuch mit demselben Gerätecode läuft danach in
    // „abgelaufen“ – der Token existiert weiter, aber nur noch beim Plugin.
    await this.db
      .update(deviceAuthorizations)
      .set({ tokenEncrypted: null, expiresAt: new Date() })
      .where(eq(deviceAuthorizations.id, row.id));

    const [konto] = await this.db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(eq(users.id, row.userId as string))
      .limit(1);

    return {
      token: plaintext,
      name: row.clientName,
      user: konto
        ? { id: konto.id, name: konto.name, email: konto.email, role: konto.role }
        : null,
    };
  }

  /**
   * Sucht eine Kopplung, die noch auf eine Entscheidung wartet. Alles, was
   * dagegen spricht, ergibt dieselbe 404: Ein abgelaufener, ein abgelehnter
   * und ein erfundener Code sollen sich nicht unterscheiden lassen.
   */
  private async findePending(userCode: string): Promise<DeviceAuthorizationRow> {
    const code = normalizeUserCode(userCode);
    if (!code) throw new NotFoundException('Dieser Code stimmt nicht.');

    const [row] = await this.db
      .select()
      .from(deviceAuthorizations)
      .where(
        and(
          eq(deviceAuthorizations.userCode, code),
          gt(deviceAuthorizations.expiresAt, new Date()),
          isNull(deviceAuthorizations.approvedAt),
          isNull(deviceAuthorizations.deniedAt),
        ),
      )
      .orderBy(desc(deviceAuthorizations.createdAt))
      .limit(1);

    if (!row) {
      throw new NotFoundException(
        'Zu diesem Code wartet nichts (mehr). Bitte im Plugin neu starten.',
      );
    }
    return row;
  }

  /**
   * Ein Benutzercode, der gerade nicht schon vergeben ist. Bei 8,5·10^11
   * Möglichkeiten ist eine Kollision unter den paar gleichzeitig offenen
   * Kopplungen kaum vorstellbar – aber „kaum" ist kein Grund, jemanden auf
   * eine fremde Kopplung schauen zu lassen.
   */
  private async freierBenutzercode(): Promise<string> {
    for (let versuch = 0; versuch < 5; versuch += 1) {
      const kandidat = createUserCode();
      const [belegt] = await this.db
        .select({ id: deviceAuthorizations.id })
        .from(deviceAuthorizations)
        .where(
          and(
            eq(deviceAuthorizations.userCode, kandidat),
            gt(deviceAuthorizations.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!belegt) return kandidat;
    }
    throw new BadRequestException('Gerade ist kein Code frei. Bitte gleich noch einmal probieren.');
  }
}

function sauberName(value: string | undefined): string {
  const name = (value ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  return name || DEFAULT_CLIENT_NAME;
}
