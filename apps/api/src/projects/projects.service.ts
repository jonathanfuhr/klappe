import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectDto } from '@klappe/shared';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { AccessService, type AccessScope } from '../access/access.service';
import type { RequestUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { projectFiles, projects, users, videos } from '../db/schema';
import type { CreateProjectDto, UpdateProjectDto } from './projects.dto';

type ProjectQueryRow = {
  project: typeof projects.$inferSelect;
  creatorId: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  videoCount: number;
  fileCount: number;
};

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
      })
      .from(projects)
      .leftJoin(users, eq(projects.createdById, users.id));
  }

  /**
   * Team-Mitglieder sehen laut Konzept alle Projekte des Workspace. Gäste
   * sehen ausschließlich das, wofür es eine Freigabe gibt – die Liste wird
   * deshalb schon in der Abfrage eingeschränkt und nicht erst danach.
   */
  async list(scope: AccessScope): Promise<ProjectDto[]> {
    if (!scope.unrestricted) {
      const allowed = this.accessService.visibleProjects(scope);
      if (allowed.length === 0) return [];
      const rows = await this.baseQuery()
        .where(inArray(projects.id, allowed))
        .orderBy(desc(projects.updatedAt));
      return rows.map((row) => this.toDto(row, scope));
    }

    const rows = await this.baseQuery().orderBy(desc(projects.updatedAt));
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
    };
  }
}
