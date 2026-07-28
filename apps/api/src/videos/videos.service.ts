import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { VersionDto, VideoDto } from '@klappe/shared';
import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { RequestUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { comments, users, videoVersions, videos } from '../db/schema';
import { ProjectsService } from '../projects/projects.service';
import { VersionsService } from '../versions/versions.service';
import type { CreateVideoDto, UpdateVideoDto } from './videos.dto';

@Injectable()
export class VideosService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly projectsService: ProjectsService,
    private readonly versionsService: VersionsService,
  ) {}

  async listForProject(projectId: string): Promise<VideoDto[]> {
    await this.projectsService.assertExists(projectId);

    const rows = await this.db
      .select({
        video: videos,
        creatorId: users.id,
        creatorName: users.name,
        creatorEmail: users.email,
      })
      .from(videos)
      .leftJoin(users, eq(videos.createdById, users.id))
      .where(eq(videos.projectId, projectId))
      .orderBy(asc(videos.sortOrder), asc(videos.createdAt));

    if (rows.length === 0) return [];

    const latestByVideo = await this.loadLatestVersions(rows.map((row) => row.video.id));

    return rows.map((row) => ({
      id: row.video.id,
      projectId: row.video.projectId,
      name: row.video.name,
      description: row.video.description,
      createdAt: row.video.createdAt.toISOString(),
      updatedAt: row.video.updatedAt.toISOString(),
      createdBy:
        row.creatorId && row.creatorName && row.creatorEmail
          ? { id: row.creatorId, name: row.creatorName, email: row.creatorEmail }
          : null,
      versionCount: latestByVideo.get(row.video.id)?.count ?? 0,
      latestVersion: latestByVideo.get(row.video.id)?.latest ?? null,
    }));
  }

  async findOneOrFail(id: string): Promise<VideoDto> {
    const [row] = await this.db
      .select({
        video: videos,
        creatorId: users.id,
        creatorName: users.name,
        creatorEmail: users.email,
      })
      .from(videos)
      .leftJoin(users, eq(videos.createdById, users.id))
      .where(eq(videos.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Video nicht gefunden.');

    const latest = await this.loadLatestVersions([id]);

    return {
      id: row.video.id,
      projectId: row.video.projectId,
      name: row.video.name,
      description: row.video.description,
      createdAt: row.video.createdAt.toISOString(),
      updatedAt: row.video.updatedAt.toISOString(),
      createdBy:
        row.creatorId && row.creatorName && row.creatorEmail
          ? { id: row.creatorId, name: row.creatorName, email: row.creatorEmail }
          : null,
      versionCount: latest.get(id)?.count ?? 0,
      latestVersion: latest.get(id)?.latest ?? null,
    };
  }

  async create(projectId: string, dto: CreateVideoDto, user: RequestUser): Promise<VideoDto> {
    await this.projectsService.assertExists(projectId);

    const [{ nextOrder }] = await this.db
      .select({ nextOrder: sql<number>`coalesce(max(${videos.sortOrder}), -1)::int + 1` })
      .from(videos)
      .where(eq(videos.projectId, projectId));

    const [row] = await this.db
      .insert(videos)
      .values({
        projectId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        sortOrder: nextOrder,
        createdById: user.id,
      })
      .returning();

    await this.projectsService.touch(projectId);
    return this.findOneOrFail(row.id);
  }

  async update(id: string, dto: UpdateVideoDto): Promise<VideoDto> {
    const [row] = await this.db
      .update(videos)
      .set({
        name: dto.name === undefined ? undefined : dto.name.trim(),
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        sortOrder: dto.sortOrder,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, id))
      .returning();
    if (!row) throw new NotFoundException('Video nicht gefunden.');
    await this.projectsService.touch(row.projectId);
    return this.findOneOrFail(row.id);
  }

  /** Gibt die Ablage-Schlüssel zurück, damit der Aufrufer die Dateien löschen kann. */
  async remove(id: string): Promise<string[]> {
    const versions = await this.db
      .select()
      .from(videoVersions)
      .where(eq(videoVersions.videoId, id));

    const [row] = await this.db.delete(videos).where(eq(videos.id, id)).returning();
    if (!row) throw new NotFoundException('Video nicht gefunden.');
    await this.projectsService.touch(row.projectId);

    return versions
      .flatMap((version) => [version.originalKey, version.proxyKey, version.posterKey, version.spriteKey])
      .filter((key): key is string => Boolean(key));
  }

  async assertExists(id: string): Promise<void> {
    const [row] = await this.db.select({ id: videos.id }).from(videos).where(eq(videos.id, id)).limit(1);
    if (!row) throw new NotFoundException('Video nicht gefunden.');
  }

  /**
   * Holt für mehrere Videos in einer Abfrage alle Versionen und bestimmt
   * daraus die jeweils neueste – statt pro Video eine eigene Abfrage.
   */
  private async loadLatestVersions(
    videoIds: string[],
  ): Promise<Map<string, { latest: VersionDto; count: number }>> {
    const rows = await this.db
      .select({
        version: videoVersions,
        uploaderId: users.id,
        uploaderName: users.name,
        uploaderEmail: users.email,
        commentCount: sql<number>`(
          select count(*)::int from ${comments}
          where ${comments.versionId} = ${videoVersions.id} and ${comments.deletedAt} is null
        )`,
      })
      .from(videoVersions)
      .leftJoin(users, eq(videoVersions.uploadedById, users.id))
      .where(inArray(videoVersions.videoId, videoIds))
      .orderBy(desc(videoVersions.versionNumber));

    const result = new Map<string, { latest: VersionDto; count: number }>();
    for (const row of rows) {
      const existing = result.get(row.version.videoId);
      if (existing) {
        existing.count += 1;
        continue;
      }
      // Dank der Sortierung ist die erste Zeile je Video die neueste Version.
      result.set(row.version.videoId, { latest: this.versionsService.toDto(row), count: 1 });
    }
    return result;
  }
}
