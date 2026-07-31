/**
 * Der Schalter „Externer API-Zugriff" (Phase 25).
 *
 * Eine einzige Einstellung, aber mit Nebenwirkung: Der Wächter puffert ihren
 * Wert ein paar Sekunden, damit nicht jede Anfrage mit Bearer-Header eine
 * zweite Abfrage auslöst. Wer hier speichert, muss diesen Puffer verwerfen –
 * sonst bliebe ein Abschalten quälende Sekunden ohne Wirkung, und genau in
 * diesen Sekunden schaut der Betreiber hin.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ApiAccessSettingsDto } from '@klappe/shared';
import { and, count, eq, isNull } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { apiTokens, appSettings } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { ApiTokensService } from './api-tokens.service';

const SETTINGS_ID = 1;

@Injectable()
export class ApiAccessService {
  private readonly logger = new Logger(ApiAccessService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly tokens: ApiTokensService,
  ) {}

  async get(): Promise<ApiAccessSettingsDto> {
    const row = await this.settings.getRow();
    const [aktiv] = await this.db
      .select({ anzahl: count() })
      .from(apiTokens)
      .where(isNull(apiTokens.revokedAt));

    return {
      enabled: row.apiAccessEnabled,
      activeTokens: Number(aktiv?.anzahl ?? 0),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async update(enabled: boolean): Promise<ApiAccessSettingsDto> {
    await this.settings.getRow();
    await this.db
      .update(appSettings)
      .set({ apiAccessEnabled: enabled, updatedAt: new Date() })
      .where(eq(appSettings.id, SETTINGS_ID));

    this.tokens.forgetAccessCache();
    this.logger.log(`Externer API-Zugriff ist jetzt ${enabled ? 'an' : 'aus'}.`);
    return this.get();
  }
}
