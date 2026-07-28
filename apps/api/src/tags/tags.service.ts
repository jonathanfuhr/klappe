/**
 * Schlagworte für Projekte (Phase 12).
 *
 * Workspace-weit statt pro Projekt: Der Sinn eines Tags ist gerade, mehrere
 * Projekte zusammenzufassen. Gäste haben damit nichts zu tun – sie sehen
 * ohnehin nur ihr eigenes Projekt.
 */
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { TagDto } from '@klappe/shared';
import { colorForTagName, normalizeHexColor, normalizeTagName } from '@klappe/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { RequestUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { projectTags, projects, tags } from '../db/schema';

@Injectable()
export class TagsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(): Promise<TagDto[]> {
    const rows = await this.db
      .select({
        id: tags.id,
        name: tags.name,
        color: tags.color,
        createdAt: tags.createdAt,
        projectCount: sql<number>`(select count(*)::int from ${projectTags} pt where pt.tag_id = ${tags.id})`,
      })
      .from(tags)
      .orderBy(sql`lower(${tags.name})`);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color ?? colorForTagName(row.name),
      projectCount: row.projectCount,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async create(input: { name: string; color?: string }, user: RequestUser): Promise<TagDto> {
    const name = normalizeTagName(input.name);
    if (!name) throw new ConflictException('Ein Schlagwort braucht einen Namen.');

    const [existing] = await this.db
      .select({ id: tags.id })
      .from(tags)
      .where(sql`lower(${tags.name}) = ${name.toLowerCase()}`)
      .limit(1);
    if (existing) throw new ConflictException(`Das Schlagwort „${name}" gibt es schon.`);

    const [row] = await this.db
      .insert(tags)
      .values({
        name,
        color: normalizeHexColor(input.color),
        createdById: user.id,
      })
      .returning();

    return this.findOneOrFail(row.id);
  }

  async update(id: string, input: { name?: string; color?: string | null }): Promise<TagDto> {
    if (input.name !== undefined) {
      const name = normalizeTagName(input.name);
      if (!name) throw new ConflictException('Ein Schlagwort braucht einen Namen.');

      const [collision] = await this.db
        .select({ id: tags.id })
        .from(tags)
        .where(sql`lower(${tags.name}) = ${name.toLowerCase()} and ${tags.id} <> ${id}`)
        .limit(1);
      if (collision) throw new ConflictException(`Das Schlagwort „${name}" gibt es schon.`);
    }

    const [row] = await this.db
      .update(tags)
      .set({
        name: input.name === undefined ? undefined : normalizeTagName(input.name),
        // Leere Farbe heißt: wieder aus dem Namen ableiten.
        color: input.color === undefined ? undefined : normalizeHexColor(input.color),
        updatedAt: new Date(),
      })
      .where(eq(tags.id, id))
      .returning();
    if (!row) throw new NotFoundException('Schlagwort nicht gefunden.');

    return this.findOneOrFail(row.id);
  }

  async remove(id: string): Promise<void> {
    const [row] = await this.db.delete(tags).where(eq(tags.id, id)).returning();
    if (!row) throw new NotFoundException('Schlagwort nicht gefunden.');
  }

  /**
   * Setzt die Schlagworte eines Projekts auf genau diese Liste. Ein Setzen
   * statt Einzelbefehlen erspart der Oberfläche das Nachhalten, was sich
   * gerade geändert hat.
   */
  async setForProject(projectId: string, tagIds: string[]): Promise<void> {
    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException('Projekt nicht gefunden.');

    const eindeutig = [...new Set(tagIds)];

    if (eindeutig.length > 0) {
      const vorhanden = await this.db
        .select({ id: tags.id })
        .from(tags)
        .where(inArray(tags.id, eindeutig));
      if (vorhanden.length !== eindeutig.length) {
        throw new NotFoundException('Mindestens ein Schlagwort gibt es nicht (mehr).');
      }
    }

    await this.db.transaction(async (trx) => {
      await trx.delete(projectTags).where(eq(projectTags.projectId, projectId));
      if (eindeutig.length > 0) {
        await trx
          .insert(projectTags)
          .values(eindeutig.map((tagId) => ({ projectId, tagId })));
      }
    });
  }

  /** Ein einzelnes Schlagwort an- oder abhängen. */
  async setOnProject(projectId: string, tagId: string, assigned: boolean): Promise<void> {
    if (assigned) {
      await this.db.insert(projectTags).values({ projectId, tagId }).onConflictDoNothing();
      return;
    }
    await this.db
      .delete(projectTags)
      .where(and(eq(projectTags.projectId, projectId), eq(projectTags.tagId, tagId)));
  }

  private async findOneOrFail(id: string): Promise<TagDto> {
    const alle = await this.list();
    const treffer = alle.find((tag) => tag.id === id);
    if (!treffer) throw new NotFoundException('Schlagwort nicht gefunden.');
    return treffer;
  }
}
