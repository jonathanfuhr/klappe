import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type AiKindDto, type UserRole, type VersionDto, type VideoDto, videoWebPath } from '@klappe/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AccessService, type AccessScope } from '../access/access.service';
import { AiContentService } from '../ai/ai-content.service';
import type { RequestUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { comments, projects, users, videoVersions, videos } from '../db/schema';
import { ProjectsService } from '../projects/projects.service';
import { StorageService } from '../storage/storage.service';
import { VersionsService } from '../versions/versions.service';
import type { CreateVideoDto, UpdateVideoDto } from './videos.dto';

/** Zweiter Blick auf `users` – für den Freigabe-Vermerk der Fassung (Phase 27). */
const releasers = alias(users, 'releasers');

type VideoRow = {
  video: typeof videos.$inferSelect;
  creatorId: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  creatorRole: UserRole | null;
  projectName?: string | null;
  projectCustomer?: string | null;
};

@Injectable()
export class VideosService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly projectsService: ProjectsService,
    private readonly versionsService: VersionsService,
    private readonly accessService: AccessService,
    private readonly storage: StorageService,
    private readonly aiContent: AiContentService,
  ) {}

  async listForProject(projectId: string, scope: AccessScope): Promise<VideoDto[]> {
    await this.projectsService.assertExists(projectId);
    this.accessService.assertCanViewProject(scope, projectId);

    // Bei einer Videofreigabe sieht der Gast nur genau dieses Video – nicht
    // die übrigen Videos desselben Projekts.
    const allowedVideoIds = this.accessService.visibleVideos(scope, projectId);
    if (allowedVideoIds !== null && allowedVideoIds.length === 0) return [];

    const rows = await this.db
      .select({
        video: videos,
        creatorId: users.id,
        creatorName: users.name,
        creatorEmail: users.email,
        creatorRole: users.role,
        projectName: projects.name,
        projectCustomer: projects.customer,
      })
      .from(videos)
      .leftJoin(users, eq(videos.createdById, users.id))
      .leftJoin(projects, eq(videos.projectId, projects.id))
      .where(
        allowedVideoIds === null
          ? eq(videos.projectId, projectId)
          : and(eq(videos.projectId, projectId), inArray(videos.id, allowedVideoIds)),
      )
      .orderBy(asc(videos.sortOrder), asc(videos.createdAt));

    if (rows.length === 0) return [];

    const [latestByVideo, ki] = await Promise.all([
      this.loadLatestVersions(
        rows.map((row) => row.video),
        scope,
      ),
      this.loadAiKennzeichnung(rows.map((row) => row.video.id)),
    ]);

    return rows.map((row) => this.toDto(row, latestByVideo, scope, ki));
  }

  async findOneOrFail(id: string, scope: AccessScope): Promise<VideoDto> {
    const [row] = await this.db
      .select({
        video: videos,
        creatorId: users.id,
        creatorName: users.name,
        creatorEmail: users.email,
        creatorRole: users.role,
        // Für die Brotkrumen: Ohne den Namen stünde dort nur „Projekt".
        projectName: projects.name,
        projectCustomer: projects.customer,
      })
      .from(videos)
      .leftJoin(users, eq(videos.createdById, users.id))
      .leftJoin(projects, eq(videos.projectId, projects.id))
      .where(eq(videos.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Video nicht gefunden.');
    this.accessService.assertCanViewVideo(scope, row.video);

    const [latest, ki] = await Promise.all([
      this.loadLatestVersions([row.video], scope),
      this.loadAiKennzeichnung([row.video.id]),
    ]);
    return this.toDto(row, latest, scope, ki);
  }

  async create(
    projectId: string,
    dto: CreateVideoDto,
    user: RequestUser,
    scope: AccessScope,
  ): Promise<VideoDto> {
    await this.projectsService.assertExists(projectId);
    this.accessService.assertCanManageProject(scope, projectId);

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
    return this.findOneOrFail(row.id, scope);
  }

  async update(id: string, dto: UpdateVideoDto, scope: AccessScope): Promise<VideoDto> {
    const [row] = await this.db
      .update(videos)
      .set({
        name: dto.name === undefined ? undefined : dto.name.trim(),
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        sortOrder: dto.sortOrder,
        downloadsEnabled: dto.downloadsEnabled,
        aiContent: dto.aiContent,
        updatedAt: new Date(),
      })
      .where(eq(videos.id, id))
      .returning();
    if (!row) throw new NotFoundException('Video nicht gefunden.');
    // Die Auswahl der Arten wird als Ganzes ersetzt (Phase 24, Nachtrag).
    if (dto.aiKindIds !== undefined) {
      await this.aiContent.setKindsForVideo(row.id, dto.aiKindIds);
    }
    await this.projectsService.touch(row.projectId);
    return this.findOneOrFail(row.id, scope);
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
      .flatMap((version) => [
        version.originalKey,
        version.proxyKey,
        version.posterKey,
        version.spriteKey,
        version.hlsKey,
        // Die erzeugten Download-Formate (Phase 19) liegen je Fassung in
        // einem eigenen Verzeichnis.
        this.storage.keyForRenditionDir(version.id),
      ])
      .filter((key): key is string => Boolean(key));
  }

  async assertExists(id: string): Promise<void> {
    const [row] = await this.db.select({ id: videos.id }).from(videos).where(eq(videos.id, id)).limit(1);
    if (!row) throw new NotFoundException('Video nicht gefunden.');
  }

  private toDto(
    row: VideoRow,
    latestByVideo: Map<string, { latest: VersionDto; count: number }>,
    scope: AccessScope,
    ki: { enabled: boolean; kinds: Map<string, AiKindDto[]> },
  ): VideoDto {
    return {
      id: row.video.id,
      projectId: row.video.projectId,
      name: row.video.name,
      description: row.video.description,
      createdAt: row.video.createdAt.toISOString(),
      updatedAt: row.video.updatedAt.toISOString(),
      createdBy:
        row.creatorId && row.creatorName && row.creatorEmail
          ? {
              id: row.creatorId,
              name: row.creatorName,
              email: row.creatorEmail,
              role: row.creatorRole ?? 'GUEST',
            }
          : null,
      projectName: row.projectName ?? null,
      projectCustomer: row.projectCustomer ?? null,
      versionCount: latestByVideo.get(row.video.id)?.count ?? 0,
      latestVersion: latestByVideo.get(row.video.id)?.latest ?? null,
      downloadsEnabled: row.video.downloadsEnabled,
      /*
       * Ist die Kennzeichnung im Workspace abgeschaltet, kommt hier immer
       * `false` an – der Haken bleibt gespeichert, wirkt aber nirgends.
       */
      aiContent: ki.enabled && row.video.aiContent,
      aiKinds: ki.enabled && row.video.aiContent ? (ki.kinds.get(row.video.id) ?? []) : [],
      canComment: this.accessService.canCommentOn(scope, row.video),
      canManage: this.accessService.canManageProject(scope, row.video.projectId),
      webUrl: videoWebPath(row.video.id),
    };
  }

  /** Schalter und Arten-Zuordnung für die KI-Kennzeichnung (Phase 24, Nachtrag). */
  private async loadAiKennzeichnung(
    videoIds: string[],
  ): Promise<{ enabled: boolean; kinds: Map<string, AiKindDto[]> }> {
    const enabled = await this.aiContent.isEnabled();
    // Abgeschaltet spart die zweite Abfrage; die Zuordnungen interessieren
    // dann niemanden.
    if (!enabled) return { enabled, kinds: new Map() };
    return { enabled, kinds: await this.aiContent.kindsForVideos(videoIds) };
  }

  /**
   * Holt für mehrere Videos in einer Abfrage alle Versionen und bestimmt
   * daraus die jeweils neueste – statt pro Video eine eigene Abfrage.
   */
  private async loadLatestVersions(
    videoRows: Array<{ id: string; projectId: string; downloadsEnabled: boolean }>,
    scope: AccessScope,
  ): Promise<Map<string, { latest: VersionDto; count: number }>> {
    const nurFreigegebene = !this.accessService.canSeeInternal(scope);
    const rows = await this.db
      .select({
        version: videoVersions,
        uploaderId: users.id,
        uploaderName: users.name,
        uploaderEmail: users.email,
        uploaderRole: users.role,
        commentCount: sql<number>`(
          select count(*)::int from ${comments}
          where ${comments.versionId} = ${videoVersions.id} and ${comments.deletedAt} is null
        )`,
        releaserId: releasers.id,
        releaserName: releasers.name,
        releaserEmail: releasers.email,
        releaserRole: releasers.role,
        videoName: videos.name,
        projectName: projects.name,
        projectCustomer: projects.customer,
      })
      .from(videoVersions)
      .leftJoin(users, eq(videoVersions.uploadedById, users.id))
      .leftJoin(releasers, eq(videoVersions.releasedById, releasers.id))
      .innerJoin(videos, eq(videoVersions.videoId, videos.id))
      .innerJoin(projects, eq(videos.projectId, projects.id))
      .where(
        // Für Gäste zählt die neueste **nicht-interne** Fassung als die
        // neueste (Phase 27) – und in `versionCount` fließen interne gar nicht
        // erst ein. Sonst stünde da „3 Fassungen“ bei zwei sichtbaren.
        nurFreigegebene
          ? and(
              inArray(
                videoVersions.videoId,
                videoRows.map((video) => video.id),
              ),
              eq(videoVersions.internal, false),
            )
          : inArray(
              videoVersions.videoId,
              videoRows.map((video) => video.id),
            ),
      )
      .orderBy(desc(videoVersions.versionNumber));

    const videoById = new Map(videoRows.map((video) => [video.id, video]));
    const result = new Map<string, { latest: VersionDto; count: number }>();

    for (const row of rows) {
      const existing = result.get(row.version.videoId);
      if (existing) {
        existing.count += 1;
        continue;
      }
      const video = videoById.get(row.version.videoId);
      if (!video) continue;

      const canDownload = this.accessService.canDownload(scope, {
        videoId: video.id,
        projectId: video.projectId,
        videoDownloadsEnabled: video.downloadsEnabled,
        versionDownloadEnabled: row.version.downloadEnabled,
      });

      // Dank der Sortierung ist die erste Zeile je Video die neueste Version.
      result.set(row.version.videoId, {
        latest: this.versionsService.toDto(row, canDownload),
        count: 1,
      });
    }
    return result;
  }
}
