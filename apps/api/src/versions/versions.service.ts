import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type FrameRate,
  type VersionDto,
  type VersionStatus,
  framesToTimecode,
} from '@klappe/shared';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { RequestUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { comments, users, videoVersions, videos } from '../db/schema';
import type { VideoVersionRow } from '../db/schema';

/** Alles, was `ffprobe` über das Original herausfindet. */
export interface ProbeResult {
  durationSeconds: number | null;
  frameCount: number | null;
  frameRate: FrameRate | null;
  dropFrame: boolean;
  startTimecode: string | null;
  startTimecodeFrames: number;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrateBps: number | null;
}

/** Ergebnisse der Pipeline: Proxy, Posterframe und Sprite-Streifen. */
export interface TranscodeOutputs {
  proxyKey: string;
  proxyWidth: number;
  proxyHeight: number;
  proxySizeBytes: number;
  posterKey: string | null;
  sprite: {
    key: string;
    columns: number;
    rows: number;
    tileWidth: number;
    tileHeight: number;
    tileCount: number;
    intervalSeconds: number;
  } | null;
}

type VersionQueryRow = {
  version: VideoVersionRow;
  uploaderId: string | null;
  uploaderName: string | null;
  uploaderEmail: string | null;
  commentCount: number;
};

@Injectable()
export class VersionsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  private baseQuery() {
    return this.db
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
      .leftJoin(users, eq(videoVersions.uploadedById, users.id));
  }

  async listForVideo(videoId: string): Promise<VersionDto[]> {
    const rows = await this.baseQuery()
      .where(eq(videoVersions.videoId, videoId))
      .orderBy(desc(videoVersions.versionNumber));
    return rows.map((row) => this.toDto(row));
  }

  async findOneOrFail(id: string): Promise<VersionDto> {
    const [row] = await this.baseQuery().where(eq(videoVersions.id, id)).limit(1);
    if (!row) throw new NotFoundException('Version nicht gefunden.');
    return this.toDto(row);
  }

  async findLatestForVideo(videoId: string): Promise<VersionDto | null> {
    const [row] = await this.baseQuery()
      .where(eq(videoVersions.videoId, videoId))
      .orderBy(desc(videoVersions.versionNumber))
      .limit(1);
    return row ? this.toDto(row) : null;
  }

  /** Rohzeile für den Worker und interne Prüfungen. */
  async getRowOrFail(id: string): Promise<VideoVersionRow> {
    const [row] = await this.db
      .select()
      .from(videoVersions)
      .where(eq(videoVersions.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Version nicht gefunden.');
    return row;
  }

  /**
   * Legt die nächste Version eines Videos an. Die Nummer wird aus der
   * höchsten vorhandenen abgeleitet; der eindeutige Index auf
   * (video_id, version_number) fängt ein Rennen zweier paralleler Uploads ab.
   */
  async createNextVersion(input: {
    videoId: string;
    filename: string;
    sizeBytes: number;
    mimeType: string | null;
    label: string | null;
    user: RequestUser;
  }): Promise<VideoVersionRow> {
    const [video] = await this.db
      .select({ id: videos.id })
      .from(videos)
      .where(eq(videos.id, input.videoId))
      .limit(1);
    if (!video) throw new NotFoundException('Video nicht gefunden.');

    const [{ maxNumber }] = await this.db
      .select({ maxNumber: sql<number>`coalesce(max(${videoVersions.versionNumber}), 0)::int` })
      .from(videoVersions)
      .where(eq(videoVersions.videoId, input.videoId));

    const [row] = await this.db
      .insert(videoVersions)
      .values({
        videoId: input.videoId,
        versionNumber: maxNumber + 1,
        label: input.label,
        status: 'UPLOADING',
        uploadedById: input.user.id,
        originalFilename: input.filename,
        originalSizeBytes: input.sizeBytes,
        originalMimeType: input.mimeType,
      })
      .returning();
    return row;
  }

  async markUploadComplete(versionId: string, originalKey: string): Promise<void> {
    await this.db
      .update(videoVersions)
      .set({
        originalKey,
        status: 'PROCESSING',
        progress: 0,
        processingError: null,
        processingStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(videoVersions.id, versionId));
  }

  async applyProbe(versionId: string, probe: ProbeResult): Promise<void> {
    await this.db
      .update(videoVersions)
      .set({
        durationSeconds: probe.durationSeconds,
        frameCount: probe.frameCount,
        fpsNum: probe.frameRate?.num ?? null,
        fpsDen: probe.frameRate?.den ?? null,
        dropFrame: probe.dropFrame,
        startTimecode: probe.startTimecode,
        startTimecodeFrames: probe.startTimecodeFrames,
        width: probe.width,
        height: probe.height,
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        bitrateBps: probe.bitrateBps,
        updatedAt: new Date(),
      })
      .where(eq(videoVersions.id, versionId));
  }

  async setProgress(versionId: string, progress: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(progress)));
    await this.db
      .update(videoVersions)
      .set({ progress: clamped })
      .where(eq(videoVersions.id, versionId));
  }

  async markReady(versionId: string, outputs: TranscodeOutputs): Promise<void> {
    await this.db
      .update(videoVersions)
      .set({
        status: 'READY',
        progress: 100,
        processingError: null,
        processingFinishedAt: new Date(),
        proxyKey: outputs.proxyKey,
        proxyWidth: outputs.proxyWidth,
        proxyHeight: outputs.proxyHeight,
        proxySizeBytes: outputs.proxySizeBytes,
        posterKey: outputs.posterKey,
        spriteKey: outputs.sprite?.key ?? null,
        spriteColumns: outputs.sprite?.columns ?? null,
        spriteRows: outputs.sprite?.rows ?? null,
        spriteTileWidth: outputs.sprite?.tileWidth ?? null,
        spriteTileHeight: outputs.sprite?.tileHeight ?? null,
        spriteTileCount: outputs.sprite?.tileCount ?? null,
        spriteIntervalSeconds: outputs.sprite?.intervalSeconds ?? null,
        updatedAt: new Date(),
      })
      .where(eq(videoVersions.id, versionId));
  }

  async markFailed(versionId: string, message: string): Promise<void> {
    await this.db
      .update(videoVersions)
      .set({
        status: 'FAILED',
        processingError: message.slice(0, 2000),
        processingFinishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(videoVersions.id, versionId));
  }

  async setStatus(versionId: string, status: VersionStatus): Promise<void> {
    await this.db
      .update(videoVersions)
      .set({ status, updatedAt: new Date() })
      .where(eq(videoVersions.id, versionId));
  }

  async updateLabel(versionId: string, label: string | null): Promise<VersionDto> {
    const [row] = await this.db
      .update(videoVersions)
      .set({ label, updatedAt: new Date() })
      .where(eq(videoVersions.id, versionId))
      .returning();
    if (!row) throw new NotFoundException('Version nicht gefunden.');
    return this.findOneOrFail(row.id);
  }

  /** Löschen ist nur erlaubt, solange nicht die letzte Version übrig bleibt. */
  async remove(versionId: string): Promise<VideoVersionRow> {
    const row = await this.getRowOrFail(versionId);
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(videoVersions)
      .where(eq(videoVersions.videoId, row.videoId));
    if (count <= 1) {
      throw new BadRequestException(
        'Die letzte Version eines Videos kann nicht gelöscht werden – bitte das Video löschen.',
      );
    }
    await this.db.delete(videoVersions).where(eq(videoVersions.id, versionId));
    return row;
  }

  /** Versionen, die beim Neustart des Workers hängen geblieben sind. */
  async findStuckProcessing(): Promise<VideoVersionRow[]> {
    return this.db
      .select()
      .from(videoVersions)
      .where(and(eq(videoVersions.status, 'PROCESSING'), isNull(videoVersions.proxyKey)))
      .orderBy(asc(videoVersions.createdAt));
  }

  toDto(row: VersionQueryRow): VersionDto {
    const version = row.version;
    const frameRate =
      version.fpsNum && version.fpsDen ? { num: version.fpsNum, den: version.fpsDen } : null;

    return {
      id: version.id,
      videoId: version.videoId,
      versionNumber: version.versionNumber,
      label: version.label,
      status: version.status,
      progress: version.progress,
      processingError: version.processingError,
      originalFilename: version.originalFilename,
      originalSizeBytes: version.originalSizeBytes,
      uploadedBy:
        row.uploaderId && row.uploaderName && row.uploaderEmail
          ? { id: row.uploaderId, name: row.uploaderName, email: row.uploaderEmail }
          : null,
      createdAt: version.createdAt.toISOString(),
      media: {
        durationSeconds: version.durationSeconds,
        frameCount: version.frameCount,
        frameRate,
        dropFrame: version.dropFrame,
        startTimecode:
          version.startTimecode ??
          (frameRate
            ? framesToTimecode(version.startTimecodeFrames, frameRate, version.dropFrame)
            : null),
        startTimecodeFrames: version.startTimecodeFrames,
        width: version.width,
        height: version.height,
        videoCodec: version.videoCodec,
        audioCodec: version.audioCodec,
        bitrateBps: version.bitrateBps,
      },
      hasProxy: Boolean(version.proxyKey),
      hasPoster: Boolean(version.posterKey),
      sprite:
        version.spriteKey &&
        version.spriteColumns &&
        version.spriteRows &&
        version.spriteTileWidth &&
        version.spriteTileHeight &&
        version.spriteTileCount &&
        version.spriteIntervalSeconds
          ? {
              columns: version.spriteColumns,
              rows: version.spriteRows,
              tileWidth: version.spriteTileWidth,
              tileHeight: version.spriteTileHeight,
              tileCount: version.spriteTileCount,
              intervalSeconds: version.spriteIntervalSeconds,
            }
          : null,
      commentCount: row.commentCount,
    };
  }
}
