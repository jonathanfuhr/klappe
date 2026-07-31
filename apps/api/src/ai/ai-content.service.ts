/**
 * KI-Kennzeichnung nach Art. 50 EU AI Act (Phase 24, Nachtrag).
 *
 * Der Workspace führt einen Katalog von Arten (KI-Stimme, KI-Musik, …); ein
 * Video trägt den Haken plus eine Auswahl daraus. Der Haken sitzt am Video,
 * nicht an der Fassung – ob KI im Schnitt steckt, ändert sich nicht von v2
 * auf v3. Der globale Schalter blendet alles aus, löscht aber nichts:
 * dieselbe Mechanik wie bei den Schlagworten.
 */
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AiContentSettingsDto, AiKindDto, AiKindWithCountDto } from '@klappe/shared';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { aiContentKinds, appSettings, videoAiKinds } from '../db/schema';
import { SettingsService } from '../settings/settings.service';

const SETTINGS_ID = 1;

@Injectable()
export class AiContentService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly settingsService: SettingsService,
  ) {}

  async isEnabled(): Promise<boolean> {
    const row = await this.settingsService.getRow();
    return row.aiContentEnabled;
  }

  async getSettings(): Promise<AiContentSettingsDto> {
    const [enabled, kinds] = await Promise.all([this.isEnabled(), this.listKinds()]);
    return { enabled, kinds };
  }

  async setEnabled(enabled: boolean): Promise<AiContentSettingsDto> {
    await this.settingsService.getRow();
    await this.db
      .update(appSettings)
      .set({ aiContentEnabled: enabled, updatedAt: new Date() })
      .where(eq(appSettings.id, SETTINGS_ID));
    return this.getSettings();
  }

  private async listKinds(): Promise<AiKindWithCountDto[]> {
    const rows = await this.db
      .select({
        id: aiContentKinds.id,
        name: aiContentKinds.name,
        videoCount: sql<number>`(
          select count(*)::int from ${videoAiKinds}
          where ${videoAiKinds.kindId} = ${aiContentKinds.id}
        )`,
      })
      .from(aiContentKinds)
      .orderBy(asc(aiContentKinds.sortOrder), asc(aiContentKinds.createdAt));
    return rows;
  }

  async createKind(name: string): Promise<AiContentSettingsDto> {
    const bereinigt = name.trim().replace(/\s+/g, ' ');
    await this.assertNameFree(bereinigt);

    const [{ nextOrder }] = await this.db
      .select({ nextOrder: sql<number>`coalesce(max(${aiContentKinds.sortOrder}), -1)::int + 1` })
      .from(aiContentKinds);

    await this.db.insert(aiContentKinds).values({ name: bereinigt, sortOrder: nextOrder });
    return this.getSettings();
  }

  async renameKind(id: string, name: string): Promise<AiContentSettingsDto> {
    const bereinigt = name.trim().replace(/\s+/g, ' ');
    await this.assertNameFree(bereinigt, id);

    const [row] = await this.db
      .update(aiContentKinds)
      .set({ name: bereinigt, updatedAt: new Date() })
      .where(eq(aiContentKinds.id, id))
      .returning();
    if (!row) throw new NotFoundException('Diese Art gibt es nicht.');
    return this.getSettings();
  }

  /** Die Zuordnungen an den Videos verschwinden mit (Fremdschlüssel-Kaskade). */
  async removeKind(id: string): Promise<AiContentSettingsDto> {
    const [row] = await this.db.delete(aiContentKinds).where(eq(aiContentKinds.id, id)).returning();
    if (!row) throw new NotFoundException('Diese Art gibt es nicht.');
    return this.getSettings();
  }

  private async assertNameFree(name: string, ausserId?: string): Promise<void> {
    if (!name) throw new ConflictException('Bitte eine Bezeichnung angeben.');
    const [vorhanden] = await this.db
      .select({ id: aiContentKinds.id })
      .from(aiContentKinds)
      .where(sql`lower(${aiContentKinds.name}) = lower(${name})`)
      .limit(1);
    if (vorhanden && vorhanden.id !== ausserId) {
      throw new ConflictException(`„${name}" gibt es schon.`);
    }
  }

  // ---------- Für den VideosService ----------

  /**
   * Die Arten mehrerer Videos in einer Abfrage, in Kataloge-Reihenfolge.
   * Leerer Rückgabewert je Video heißt: Haken ohne benannte Art.
   */
  async kindsForVideos(videoIds: string[]): Promise<Map<string, AiKindDto[]>> {
    const map = new Map<string, AiKindDto[]>();
    if (videoIds.length === 0) return map;

    const rows = await this.db
      .select({
        videoId: videoAiKinds.videoId,
        id: aiContentKinds.id,
        name: aiContentKinds.name,
      })
      .from(videoAiKinds)
      .innerJoin(aiContentKinds, eq(videoAiKinds.kindId, aiContentKinds.id))
      .where(inArray(videoAiKinds.videoId, videoIds))
      .orderBy(asc(aiContentKinds.sortOrder), asc(aiContentKinds.createdAt));

    for (const row of rows) {
      const liste = map.get(row.videoId) ?? [];
      liste.push({ id: row.id, name: row.name });
      map.set(row.videoId, liste);
    }
    return map;
  }

  /**
   * Auswahl eines Videos ersetzen. Unbekannte IDs werden still verworfen –
   * eine parallel gelöschte Art soll das Speichern nicht abbrechen.
   */
  async setKindsForVideo(videoId: string, kindIds: string[]): Promise<void> {
    const gueltig =
      kindIds.length === 0
        ? []
        : await this.db
            .select({ id: aiContentKinds.id })
            .from(aiContentKinds)
            .where(inArray(aiContentKinds.id, kindIds));

    await this.db.delete(videoAiKinds).where(eq(videoAiKinds.videoId, videoId));
    if (gueltig.length > 0) {
      await this.db
        .insert(videoAiKinds)
        .values(gueltig.map(({ id }) => ({ videoId, kindId: id })));
    }
  }
}
