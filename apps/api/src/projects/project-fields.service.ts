import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FieldValueCountDto, ProjectFieldDefDto, ProjectFieldSettingsDto } from '@klappe/shared';
import { asc, eq, sql } from 'drizzle-orm';
import { uniqueViolation } from '../common/db-errors';
import { DB, type Database } from '../db/db.module';
import { appSettings, projectFieldDefs, projectFieldValues, projects } from '../db/schema';

/**
 * Benutzerdefinierte Projekt-Felder (Phase 15).
 *
 * Die Definitionen sind workspace-weit; die Werte hängen am Projekt. Bewusst
 * schlichte Textfelder: Der Anlassfall ist eine Projektnummer, und ein
 * Typsystem stünde in keinem Verhältnis zum Nutzen.
 */
@Injectable()
export class ProjectFieldsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(): Promise<ProjectFieldDefDto[]> {
    const rows = await this.db
      .select({
        def: projectFieldDefs,
        // Wie viele Projekte das Feld belegt haben – für die Warnung beim Löschen.
        projectCount: sql<number>`(
          select count(*)::int from ${projectFieldValues} v where v.field_id = ${projectFieldDefs.id}
        )`,
      })
      .from(projectFieldDefs)
      .orderBy(asc(projectFieldDefs.sortOrder), sql`lower(${projectFieldDefs.name})`);
    return rows.map((row) => this.toDto(row.def, row.projectCount));
  }

  /** Der Schalter „Schlagworte verwenden" hängt an der Workspace-Zeile. */
  async getSettings(): Promise<ProjectFieldSettingsDto> {
    const [row] = await this.db
      .select({ tagsEnabled: appSettings.tagsEnabled })
      .from(appSettings)
      .limit(1);
    return { tagsEnabled: row?.tagsEnabled ?? true };
  }

  async updateSettings(input: { tagsEnabled?: boolean }): Promise<ProjectFieldSettingsDto> {
    if (input.tagsEnabled !== undefined) {
      await this.db
        .insert(appSettings)
        .values({ id: 1, tagsEnabled: input.tagsEnabled })
        .onConflictDoUpdate({
          target: appSettings.id,
          set: { tagsEnabled: input.tagsEnabled, updatedAt: new Date() },
        });
    }
    return this.getSettings();
  }

  /**
   * Die vorkommenden Werte eines Felds samt Projektzahl – Grundlage für
   * Filter-Dropdown und Tippvorschläge (Phase 16).
   */
  async listValues(fieldId: string): Promise<FieldValueCountDto[]> {
    const [def] = await this.db
      .select({ id: projectFieldDefs.id })
      .from(projectFieldDefs)
      .where(eq(projectFieldDefs.id, fieldId))
      .limit(1);
    if (!def) throw new NotFoundException('Feld nicht gefunden.');
    return this.db
      .select({
        value: projectFieldValues.value,
        projectCount: sql<number>`count(*)::int`,
      })
      .from(projectFieldValues)
      .where(eq(projectFieldValues.fieldId, fieldId))
      .groupBy(projectFieldValues.value)
      .orderBy(sql`lower(${projectFieldValues.value})`);
  }

  async create(name: string): Promise<ProjectFieldDefDto> {
    // Ans Ende der Reihenfolge, nicht mittenrein.
    const [{ max }] = await this.db
      .select({ max: sql<number>`coalesce(max(${projectFieldDefs.sortOrder}), 0)` })
      .from(projectFieldDefs);
    const [row] = await this.db
      .insert(projectFieldDefs)
      .values({ name: name.trim(), sortOrder: max + 1 })
      .returning()
      .catch((error: unknown) => {
        throw duplikatOderWeiter(error, name);
      });
    return this.toDto(row, 0);
  }

  async update(
    id: string,
    input: {
      name?: string;
      sortOrder?: number;
      suggest?: boolean;
      filterable?: boolean;
      sortable?: boolean;
      groupable?: boolean;
      showOnTile?: boolean;
    },
  ): Promise<ProjectFieldDefDto> {
    const [row] = await this.db
      .update(projectFieldDefs)
      .set({
        name: input.name === undefined ? undefined : input.name.trim(),
        sortOrder: input.sortOrder,
        suggest: input.suggest,
        filterable: input.filterable,
        sortable: input.sortable,
        groupable: input.groupable,
        showOnTile: input.showOnTile,
        updatedAt: new Date(),
      })
      .where(eq(projectFieldDefs.id, id))
      .returning()
      .catch((error: unknown) => {
        throw duplikatOderWeiter(error, input.name ?? '');
      });
    if (!row) throw new NotFoundException('Feld nicht gefunden.');
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectFieldValues)
      .where(eq(projectFieldValues.fieldId, id));
    return this.toDto(row, count);
  }

  /** Löscht die Definition; die Werte an den Projekten fallen per Kaskade mit. */
  async remove(id: string): Promise<void> {
    const [row] = await this.db
      .delete(projectFieldDefs)
      .where(eq(projectFieldDefs.id, id))
      .returning();
    if (!row) throw new NotFoundException('Feld nicht gefunden.');
  }

  /**
   * Alle Werte eines Projekts in einem Rutsch setzen. Ein leerer Wert löscht
   * den Eintrag – „Feld leeren“ und „Eintrag entfernen“ sind dasselbe.
   */
  async setValues(projectId: string, werte: { fieldId: string; value: string }[]): Promise<void> {
    const [projekt] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!projekt) throw new NotFoundException('Projekt nicht gefunden.');

    for (const eintrag of werte) {
      const wert = eintrag.value.trim();
      if (!wert) {
        await this.db
          .delete(projectFieldValues)
          .where(
            sql`${projectFieldValues.projectId} = ${projectId} and ${projectFieldValues.fieldId} = ${eintrag.fieldId}`,
          );
        continue;
      }
      await this.db
        .insert(projectFieldValues)
        .values({ projectId, fieldId: eintrag.fieldId, value: wert })
        .onConflictDoUpdate({
          target: [projectFieldValues.projectId, projectFieldValues.fieldId],
          set: { value: wert, updatedAt: new Date() },
        })
        .catch(() => {
          // Ein unbekanntes Feld (FK-Fehler) soll die übrigen nicht mitreißen –
          // das passiert, wenn jemand parallel eine Definition löscht.
          throw new BadRequestException('Eines der Felder gibt es nicht mehr.');
        });
    }
  }

  private toDto(row: typeof projectFieldDefs.$inferSelect, projectCount: number): ProjectFieldDefDto {
    return {
      id: row.id,
      name: row.name,
      sortOrder: row.sortOrder,
      suggest: row.suggest,
      filterable: row.filterable,
      sortable: row.sortable,
      groupable: row.groupable,
      showOnTile: row.showOnTile,
      projectCount,
    };
  }
}

/**
 * Der eindeutige Index meldet sich als Postgres-Fehler 23505 – allerdings
 * eingepackt in einen `DrizzleQueryError`, weshalb er nicht auf der obersten
 * Ebene steht. Ohne den Blick in die `cause`-Kette wurde aus dem Hinweis ein
 * nacktes 500 (bemerkt in Phase 19).
 */
function duplikatOderWeiter(error: unknown, name: string): unknown {
  if (uniqueViolation(error) !== null) {
    return new BadRequestException(`Ein Feld namens „${name.trim()}“ gibt es schon.`);
  }
  return error;
}
