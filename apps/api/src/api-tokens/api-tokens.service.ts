/**
 * API-Tokens: ausstellen, prüfen, widerrufen (Phase 25).
 *
 * Ein Token vertritt eine Person, keine Anwendung. Er trägt weder eigene
 * Rechte noch einen eigenen Namen an Kommentaren – wer über ein Plugin
 * kommentiert, steht dort mit seinem Konto. Das hält die Rechteprüfung an
 * einer Stelle: Alles, was ein Token darf, entscheidet weiterhin der
 * `AccessService` anhand des Kontos.
 */
import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ApiTokenDto } from '@klappe/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { type ApiTokenRow, apiTokens, users } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { createApiToken, maskApiToken, parseApiToken, verifyApiTokenSecret } from './api-token';

/**
 * Wie oft `lastUsedAt` höchstens geschrieben wird. Die Angabe soll die Frage
 * „wird das noch benutzt?“ beantworten – dafür genügt Minutengenauigkeit, und
 * ein Schreibvorgang je API-Anfrage wäre für einen laufenden Upload spürbar.
 */
const LAST_USED_THROTTLE_MS = 60_000;

/**
 * So lange gilt die zwischengespeicherte Antwort auf „ist der externe Zugriff
 * an?“. Der Wächter fragt bei jeder Anfrage mit Bearer-Header danach; ohne
 * diesen Puffer käme je Anfrage eine zweite Abfrage dazu. Fünf Sekunden sind
 * kurz genug, dass ein Abschalten sofort wirkt – und beim Speichern in den
 * Einstellungen wird der Puffer ohnehin verworfen.
 */
const ACCESS_CACHE_MS = 5_000;

export interface VerifiedApiToken {
  tokenId: string;
  userId: string;
}

@Injectable()
export class ApiTokensService {
  private readonly logger = new Logger(ApiTokensService.name);
  private accessCache: { value: boolean; until: number } | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Ist externer Zugriff überhaupt erlaubt? Ab Werk nicht – der Betreiber
   * schaltet ihn in den Einstellungen frei.
   */
  async isApiAccessEnabled(): Promise<boolean> {
    const jetzt = Date.now();
    if (this.accessCache && this.accessCache.until > jetzt) return this.accessCache.value;

    const row = await this.settings.getRow();
    this.accessCache = { value: row.apiAccessEnabled, until: jetzt + ACCESS_CACHE_MS };
    return row.apiAccessEnabled;
  }

  /** Nach dem Umlegen des Schalters: Der Puffer darf nicht nachhängen. */
  forgetAccessCache(): void {
    this.accessCache = null;
  }

  /**
   * Prüft einen Token aus dem `Authorization`-Header.
   *
   * `null` heißt in jedem Fall „gilt nicht“ – ohne Auskunft darüber, woran es
   * lag. Ob der Token unbekannt, widerrufen oder das Konto gesperrt ist, geht
   * den Aufrufer nichts an; jede Unterscheidung wäre eine Auskunft an jemanden,
   * der sich gerade nicht ausweisen konnte.
   */
  async verify(value: string): Promise<VerifiedApiToken | null> {
    const teile = parseApiToken(value);
    if (!teile) return null;

    const [row] = await this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.selector, teile.selector))
      .limit(1);

    if (!row || row.revokedAt) return null;
    if (!verifyApiTokenSecret(teile.secret, row.secretHash)) return null;

    void this.touch(row);
    return { tokenId: row.id, userId: row.userId };
  }

  /**
   * Schreibt den Zeitpunkt der letzten Benutzung fort – nebenläufig und
   * gedrosselt. Ein Fehler dabei darf die Anfrage nicht scheitern lassen: Der
   * Zeitstempel ist eine Bequemlichkeit, kein Teil der Rechteprüfung.
   */
  private async touch(row: ApiTokenRow): Promise<void> {
    const jetzt = Date.now();
    if (row.lastUsedAt && jetzt - row.lastUsedAt.getTime() < LAST_USED_THROTTLE_MS) return;

    try {
      await this.db
        .update(apiTokens)
        .set({ lastUsedAt: new Date(jetzt) })
        .where(eq(apiTokens.id, row.id));
    } catch (error) {
      this.logger.warn(`Zeitstempel des Tokens ${maskApiToken(row.selector)} nicht geschrieben.`, error);
    }
  }

  /**
   * Stellt einen Token aus und liefert ihn **einmal** im Klartext zurück.
   * Danach steht in der Datenbank nur noch der Hash; ein zweites Mal lässt er
   * sich nirgends herholen.
   */
  async issue(input: {
    userId: string;
    name: string;
    origin: 'device' | 'manual';
  }): Promise<{ token: ApiTokenDto; plaintext: string }> {
    const neu = createApiToken();

    const [row] = await this.db
      .insert(apiTokens)
      .values({
        userId: input.userId,
        name: input.name.trim().slice(0, 120) || 'Unbenanntes Gerät',
        selector: neu.selector,
        secretHash: neu.secretHash,
        origin: input.origin,
      })
      .returning();

    this.logger.log(`API-Token ausgestellt: ${row.name} (${maskApiToken(row.selector)})`);
    return { token: toDto(row), plaintext: neu.plaintext };
  }

  /** Die eigenen Tokens – widerrufene zuletzt, damit die Liste nicht lügt. */
  async listForUser(userId: string): Promise<ApiTokenDto[]> {
    const rows = await this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, userId))
      .orderBy(desc(apiTokens.createdAt));
    return rows.map(toDto);
  }

  /**
   * Alle Tokens des Workspace, mit Konto dazu (Admin). Der Betreiber muss
   * sehen können, welche Geräte insgesamt offenstehen – nicht nur seine
   * eigenen.
   */
  async listAll(): Promise<ApiTokenDto[]> {
    const rows = await this.db
      .select({
        token: apiTokens,
        userName: users.name,
        userEmail: users.email,
        userRole: users.role,
      })
      .from(apiTokens)
      .innerJoin(users, eq(users.id, apiTokens.userId))
      .orderBy(desc(apiTokens.createdAt));

    return rows.map((row) => ({
      ...toDto(row.token),
      user: {
        id: row.token.userId,
        name: row.userName,
        email: row.userEmail,
        role: row.userRole,
      },
    }));
  }

  /**
   * Widerruft einen Token.
   *
   * `scope` sagt, aus welcher Tür der Aufruf kommt, und das ist wörtlich zu
   * nehmen: `own` trifft ausschließlich eigene Geräte – auch für einen Admin.
   * An fremde kommt nur die Verwaltungsroute (`any`), die ihrerseits schon per
   * `@Roles('ADMIN')` verschlossen ist. So bedeutet jede Route genau eine
   * Sache; ein Admin, der versehentlich eine fremde Kennung in die eigene
   * Liste tippt, trifft nichts.
   *
   * Ein fremder Token ergibt **404**, nicht 403 – wie überall sonst in dieser
   * API würde ein 403 verraten, dass es ihn gibt.
   */
  async revoke(
    id: string,
    actor: { id: string; role: string },
    scope: 'own' | 'any' = 'own',
  ): Promise<void> {
    const [row] = await this.db.select().from(apiTokens).where(eq(apiTokens.id, id)).limit(1);

    const fremd = row ? row.userId !== actor.id : false;
    if (!row || (scope === 'own' && fremd)) {
      throw new NotFoundException('Dieses Gerät gibt es nicht.');
    }
    if (scope === 'any' && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Fremde Geräte darf nur ein Administrator trennen.');
    }
    if (row.revokedAt) return;

    await this.db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(eq(apiTokens.id, id));

    this.logger.log(
      `API-Token widerrufen: ${row.name} (${maskApiToken(row.selector)})` +
        (fremd ? ' – durch einen Administrator' : ''),
    );
  }

  /**
   * Widerruft alle Tokens eines Kontos auf einen Schlag. Gedacht für den
   * Ernstfall („Laptop weg“) und für den Admin, der ein Konto stilllegt.
   */
  async revokeAllForUser(userId: string, actor: { id: string; role: string }): Promise<number> {
    if (actor.role !== 'ADMIN' && actor.id !== userId) {
      throw new ForbiddenException('Fremde Geräte darf nur ein Administrator trennen.');
    }

    const betroffen = await this.db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
      .returning({ id: apiTokens.id });

    if (betroffen.length > 0) {
      this.logger.log(`${betroffen.length} API-Token widerrufen (Konto ${userId}).`);
    }
    return betroffen.length;
  }

}

function toDto(row: ApiTokenRow): ApiTokenDto {
  return {
    id: row.id,
    name: row.name,
    /** Nur der Anfang – zum Wiedererkennen in der Liste, nicht zum Benutzen. */
    masked: maskApiToken(row.selector),
    origin: row.origin === 'manual' ? 'manual' : 'device',
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    user: null,
  };
}
