import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectDto, TagRefDto } from '@klappe/shared';
import { colorForTagName } from '@klappe/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AccessService, type AccessScope } from '../access/access.service';
import type { RequestUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { projectFiles, projectTags, projects, tags, users, videos } from '../db/schema';
import type { CreateProjectDto, UpdateProjectDto } from './projects.dto';

type ProjectQueryRow = {
  project: typeof projects.$inferSelect;
  creatorId: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  videoCount: number;
  fileCount: number;
  tags: { id: string; name: string; color: string | null }[] | null;
};

/** Wie die Projektliste gefiltert und sortiert werden soll (Phase 12). */
export interface ProjectListOptions {
  tagIds?: string[];
  /** `all` verlangt sämtliche gewählten Tags, `any` genügt eines. */
  tagMatch?: 'any' | 'all';
  sort?: 'updated' | 'created' | 'name';
}

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly accessService: AccessService,
  ) {}

  private baseQuery() {
    return this.db
      .select({
        project: projects,
        creatorId: users.id,
        creatorName: users.name,
        creatorEmail: users.email,
        videoCount: sql<number>`(select count(*)::int from ${videos} where ${videos.projectId} = ${projects.id})`,
        fileCount: sql<number>`(select count(*)::int from ${projectFiles} where ${projectFiles.projectId} = ${projects.id})`,
        // Die Schlagworte kommen als JSON aus derselben Abfrage; sonst
        // bräuchte die Projektliste eine zweite Runde pro Zeile.
        tags: sql<{ id: string; name: string; color: string | null }[] | null>`(
          select json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) order by lower(t.name))
          from ${projectTags} pt
          join ${tags} t on t.id = pt.tag_id
          where pt.project_id = ${projects.id}
        )`,
      })
      .from(projects)
      .leftJoin(users, eq(projects.createdById, users.id));
  }

  /**
   * Team-Mitglieder sehen laut Konzept alle Projekte des Workspace. Gäste
   * sehen ausschließlich das, wofür es eine Freigabe gibt – die Liste wird
   * deshalb schon in der Abfrage eingeschränkt und nicht erst danach.
   */
  async list(scope: AccessScope, options: ProjectListOptions = {}): Promise<ProjectDto[]> {
    const bedingungen = [];

    if (!scope.unrestricted) {
      const allowed = this.accessService.visibleProjects(scope);
      if (allowed.length === 0) return [];
      bedingungen.push(inArray(projects.id, allowed));
    }

    const tagIds = options.tagIds ?? [];
    if (tagIds.length > 0) {
      // `all`: Das Projekt muss jedes gewählte Schlagwort tragen – gezählt
      // wird, wie viele der gewählten es hat. `any`: eines genügt.
      bedingungen.push(
        options.tagMatch === 'all'
          ? sql`(select count(*) from ${projectTags} pt where pt.project_id = ${projects.id} and pt.tag_id in ${tagIds}) = ${tagIds.length}`
          : sql`exists (select 1 from ${projectTags} pt where pt.project_id = ${projects.id} and pt.tag_id in ${tagIds})`,
      );
    }

    const query = this.baseQuery();
    const gefiltert = bedingungen.length > 0 ? query.where(and(...bedingungen)) : query;

    const sortiert =
      options.sort === 'name'
        ? gefiltert.orderBy(sql`lower(${projects.name})`)
        : options.sort === 'created'
          ? gefiltert.orderBy(desc(projects.createdAt))
          : gefiltert.orderBy(desc(projects.updatedAt));

    const rows = await sortiert;
    return rows.map((row) => this.toDto(row, scope));
  }

  async findOneOrFail(id: string, scope: AccessScope): Promise<ProjectDto> {
    this.accessService.assertCanViewProject(scope, id);
    const [row] = await this.baseQuery().where(eq(projects.id, id)).limit(1);
    if (!row) throw new NotFoundException('Projekt nicht gefunden.');
    return this.toDto(row, scope);
  }

  /** Wirft, wenn es das Projekt nicht gibt – für Unterrouten wie Videos. */
  async assertExists(id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Projekt nicht gefunden.');
  }

  async create(dto: CreateProjectDto, user: RequestUser, scope: AccessScope): Promise<ProjectDto> {
    const [row] = await this.db
      .insert(projects)
      .values({
        name: dto.name.trim(),
        customer: dto.customer?.trim() || null,
        description: dto.description?.trim() || null,
        createdById: user.id,
      })
      .returning();
    return this.findOneOrFail(row.id, scope);
  }

  async update(id: string, dto: UpdateProjectDto, scope: AccessScope): Promise<ProjectDto> {
    const [row] = await this.db
      .update(projects)
      .set({
        name: dto.name === undefined ? undefined : dto.name.trim(),
        customer: dto.customer === undefined ? undefined : dto.customer.trim() || null,
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();
    if (!row) throw new NotFoundException('Projekt nicht gefunden.');
    return this.findOneOrFail(row.id, scope);
  }

  /**
   * Löscht das Projekt samt Videos, Versionen und Kommentaren (per Kaskade).
   * Die Dateien auf der Platte räumt der Aufrufer ab.
   */
  async remove(id: string): Promise<void> {
    const [row] = await this.db.delete(projects).where(eq(projects.id, id)).returning();
    if (!row) throw new NotFoundException('Projekt nicht gefunden.');
  }

  /** Ein Schreibzugriff im Projekt hebt es in der Liste nach oben. */
  async touch(id: string): Promise<void> {
    await this.db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, id));
  }

  private toDto(row: ProjectQueryRow, scope: AccessScope): ProjectDto {
    return {
      id: row.project.id,
      name: row.project.name,
      customer: row.project.customer,
      description: row.project.description,
      createdAt: row.project.createdAt.toISOString(),
      updatedAt: row.project.updatedAt.toISOString(),
      createdBy:
        row.creatorId && row.creatorName && row.creatorEmail
          ? { id: row.creatorId, name: row.creatorName, email: row.creatorEmail }
          : null,
      videoCount: row.videoCount,
      fileCount: row.fileCount,
      canUploadFiles: this.accessService.canUpload(scope, row.project.id),
      tags: (row.tags ?? []).map(toTagRef),
    };
  }
}

/** Ohne gespeicherte Farbe wird sie aus dem Namen abgeleitet. */
export function toTagRef(tag: { id: string; name: string; color: string | null }): TagRefDto {
  return { id: tag.id, name: tag.name, color: tag.color ?? colorForTagName(tag.name) };
}
