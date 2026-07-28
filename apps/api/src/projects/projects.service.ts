import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectDto } from '@klappe/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { RequestUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { projects, users, videos } from '../db/schema';
import type { CreateProjectDto, UpdateProjectDto } from './projects.dto';

@Injectable()
export class ProjectsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Alle Projekte des Workspace. Team-Mitglieder sehen laut Konzept immer
   * alles; die Einschränkung für Gäste kommt mit den Freigaben in Phase 6.
   */
  async list(): Promise<ProjectDto[]> {
    const rows = await this.db
      .select({
        project: projects,
        creatorId: users.id,
        creatorName: users.name,
        creatorEmail: users.email,
        videoCount: sql<number>`(select count(*)::int from ${videos} where ${videos.projectId} = ${projects.id})`,
      })
      .from(projects)
      .leftJoin(users, eq(projects.createdById, users.id))
      .orderBy(desc(projects.updatedAt));

    return rows.map((row) => this.toDto(row));
  }

  async findOneOrFail(id: string): Promise<ProjectDto> {
    const [row] = await this.db
      .select({
        project: projects,
        creatorId: users.id,
        creatorName: users.name,
        creatorEmail: users.email,
        videoCount: sql<number>`(select count(*)::int from ${videos} where ${videos.projectId} = ${projects.id})`,
      })
      .from(projects)
      .leftJoin(users, eq(projects.createdById, users.id))
      .where(eq(projects.id, id))
      .limit(1);

    if (!row) throw new NotFoundException('Projekt nicht gefunden.');
    return this.toDto(row);
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

  async create(dto: CreateProjectDto, user: RequestUser): Promise<ProjectDto> {
    const [row] = await this.db
      .insert(projects)
      .values({
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        createdById: user.id,
      })
      .returning();
    return this.findOneOrFail(row.id);
  }

  async update(id: string, dto: UpdateProjectDto): Promise<ProjectDto> {
    const [row] = await this.db
      .update(projects)
      .set({
        name: dto.name === undefined ? undefined : dto.name.trim(),
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id))
      .returning();
    if (!row) throw new NotFoundException('Projekt nicht gefunden.');
    return this.findOneOrFail(row.id);
  }

  /**
   * Löscht das Projekt samt Videos, Versionen und Kommentaren (per Kaskade).
   * Die Dateien auf der Platte räumt der Aufräum-Job ab, damit ein Löschen
   * nicht an einem hängenden Dateisystem scheitert.
   */
  async remove(id: string): Promise<void> {
    const [row] = await this.db.delete(projects).where(eq(projects.id, id)).returning();
    if (!row) throw new NotFoundException('Projekt nicht gefunden.');
  }

  /** Ein Schreibzugriff im Projekt hebt es in der Liste nach oben. */
  async touch(id: string): Promise<void> {
    await this.db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, id));
  }

  private toDto(row: {
    project: typeof projects.$inferSelect;
    creatorId: string | null;
    creatorName: string | null;
    creatorEmail: string | null;
    videoCount: number;
  }): ProjectDto {
    return {
      id: row.project.id,
      name: row.project.name,
      description: row.project.description,
      createdAt: row.project.createdAt.toISOString(),
      updatedAt: row.project.updatedAt.toISOString(),
      createdBy:
        row.creatorId && row.creatorName && row.creatorEmail
          ? { id: row.creatorId, name: row.creatorName, email: row.creatorEmail }
          : null,
      videoCount: row.videoCount,
    };
  }
}
