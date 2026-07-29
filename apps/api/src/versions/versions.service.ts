import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  type FrameRate,
  type VersionDto,
  type VersionStatus,
  buildDownloadFilename,
  checkVersionNumber,
  extensionOf,
  fileDateFromIso,
  framesToTimecode,
  nextVersionNumber,
} from '@klappe/shared';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { AccessService, type AccessScope } from '../access/access.service';
import { resolutionLabel } from '../transcode/media-plan';
import type { RequestUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { comments, projects, users, videoVersions, videos } from '../db/schema';
import type { VideoVersionRow } from '../db/schema';
import { EventsService } from '../events/events.service';
import { SubscriptionsService } from '../mail/subscriptions.service';

/** Heutiges Datum als `JJJJ-MM-TT` in Ortszeit. */
function todayIsoDate(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

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
  pixelFormat: string | null;
  formatName: string | null;
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
  /** Verzeichnis der HLS-Leiter (Phase 13); `null`, wenn keine erzeugt wurde. */
  hlsKey: string | null;
  hlsVariants: string | null;
}

export type VersionQueryRow = {
  version: VideoVersionRow;
  uploaderId: string | null;
  uploaderName: string | null;
  uploaderEmail: string | null;
  commentCount: number;
  /** Für den Download-Dateinamen nach Schema. */
  videoName?: string | null;
  projectName?: string | null;
  projectCustomer?: string | null;
};

@Injectable()
export class VersionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly accessService: AccessService,
    private readonly subscriptions: SubscriptionsService,
    private readonly events: EventsService,
  ) {}

  /**
   * Meldet, dass sich an einer Fassung etwas getan hat (Phase 18, Zusatz).
   * Nur bei Statuswechseln, nicht bei jedem Fortschrittsschritt – sonst
   * flackerte die Oberfläche im Sekundentakt für nichts.
   */
  private async meldeFassung(versionId: string): Promise<void> {
    const [row] = await this.db
      .select({ videoId: videos.id, projectId: videos.projectId })
      .from(videoVersions)
      .innerJoin(videos, eq(videoVersions.videoId, videos.id))
      .where(eq(videoVersions.id, versionId))
      .limit(1);
    if (row) this.events.publish({ topic: 'video', id: row.videoId, projectId: row.projectId });
  }

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
        videoName: videos.name,
        projectName: projects.name,
        projectCustomer: projects.customer,
      })
      .from(videoVersions)
      .leftJoin(users, eq(videoVersions.uploadedById, users.id))
      .innerJoin(videos, eq(videoVersions.videoId, videos.id))
      .innerJoin(projects, eq(videos.projectId, projects.id));
  }

  async listForVideo(videoId: string, scope: AccessScope): Promise<VersionDto[]> {
    const video = await this.accessService.requireVideo(scope, videoId);

    const rows = await this.baseQuery()
      .where(eq(videoVersions.videoId, videoId))
      .orderBy(desc(videoVersions.versionNumber));

    // In einem archivierten Projekt bleibt nur die neueste Fassung sichtbar
    // (Phase 18) – die älteren werden nach der Frist ohnehin gelöscht, und
    // eine Liste, aus der laufend Einträge verschwinden, verwirrt mehr, als
    // sie nützt. Fehlgeschlagene zählen nicht als „neueste“.
    const [projekt] = await this.db
      .select({ archivedAt: projects.archivedAt })
      .from(projects)
      .where(eq(projects.id, video.projectId))
      .limit(1);

    const sichtbar = projekt?.archivedAt
      ? rows.filter((row) => row.version.status === 'READY').slice(0, 1)
      : rows;

    return sichtbar.map((row) =>
      this.toDto(row, this.downloadAllowed(scope, video, row.version.downloadEnabled)),
    );
  }

  async findOneOrFail(id: string, scope: AccessScope): Promise<VersionDto> {
    const access = await this.accessService.requireVersion(scope, id);
    const [row] = await this.baseQuery().where(eq(videoVersions.id, id)).limit(1);
    if (!row) throw new NotFoundException('Version nicht gefunden.');
    return this.toDto(row, this.accessService.canDownload(scope, access));
  }

  /** Darf diese Fassung heruntergeladen werden? */
  private downloadAllowed(
    scope: AccessScope,
    video: { id: string; projectId: string; downloadsEnabled: boolean },
    versionDownloadEnabled: boolean,
  ): boolean {
    return this.accessService.canDownload(scope, {
      videoId: video.id,
      projectId: video.projectId,
      videoDownloadsEnabled: video.downloadsEnabled,
      versionDownloadEnabled,
    });
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

  /** Alle vergebenen Nummern eines Videos – Grundlage jeder Prüfung. */
  async takenNumbers(videoId: string): Promise<number[]> {
    const rows = await this.db
      .select({ number: videoVersions.versionNumber })
      .from(videoVersions)
      .where(eq(videoVersions.videoId, videoId));
    return rows.map((row) => Number(row.number));
  }

  /**
   * Prüft eine gewünschte Nummer gegen den Bestand und wirft eine lesbare
   * Meldung, wenn sie nicht geht. Wird zweimal aufgerufen: beim Anlegen der
   * Upload-Sitzung, damit der Fehler *vor* der Übertragung auffällt, und beim
   * Abschluss, weil in der Zwischenzeit jemand anderes dieselbe Nummer
   * vergeben haben kann.
   */
  async assertNumberFree(videoId: string, wunsch: number): Promise<number> {
    const ergebnis = checkVersionNumber(wunsch, await this.takenNumbers(videoId));
    if (!ergebnis.ok) throw new BadRequestException(ergebnis.message);
    return ergebnis.value;
  }

  /**
   * Legt die nächste Version eines Videos an. Ohne Wunschnummer wird die
   * nächste ganze Zahl über der höchsten genommen; der eindeutige Index auf
   * (video_id, version_number) fängt ein Rennen zweier paralleler Uploads ab.
   */
  async createNextVersion(input: {
    videoId: string;
    filename: string;
    sizeBytes: number;
    mimeType: string | null;
    label: string | null;
    /** `JJJJ-MM-TT`; ohne Angabe das heutige Datum. */
    fileDate: string | null;
    /** Frei gewählte Nummer, etwa 2.5. Ohne Angabe zählt Klappe selbst weiter. */
    versionNumber?: number | null;
    user: RequestUser;
  }): Promise<VideoVersionRow> {
    const [video] = await this.db
      .select({ id: videos.id })
      .from(videos)
      .where(eq(videos.id, input.videoId))
      .limit(1);
    if (!video) throw new NotFoundException('Video nicht gefunden.');

    const vergeben = await this.takenNumbers(input.videoId);
    const nummer =
      input.versionNumber === undefined || input.versionNumber === null
        ? nextVersionNumber(vergeben)
        : await this.assertNumberFree(input.videoId, input.versionNumber);

    const [row] = await this.db
      .insert(videoVersions)
      .values({
        videoId: input.videoId,
        versionNumber: nummer.toFixed(3),
        label: input.label,
        status: 'UPLOADING',
        uploadedById: input.user.id,
        originalFilename: input.filename,
        originalSizeBytes: input.sizeBytes,
        originalMimeType: input.mimeType,
        fileDate: input.fileDate ?? todayIsoDate(),
      })
      .returning();

    // Wer hochlädt, verfolgt das Video ab jetzt – ohne daran denken zu
    // müssen. Nur das Video: Ein Upload sagt nichts darüber, ob auch der
    // Rest des Projekts interessiert.
    await this.subscriptions.subscribeUploader(input.user.id, input.videoId);
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
        pixelFormat: probe.pixelFormat,
        formatName: probe.formatName,
        bitrateBps: probe.bitrateBps,
        updatedAt: new Date(),
      })
      .where(eq(videoVersions.id, versionId));
  }

  /** Hält fest, wie die Abspielfassung entstanden ist und warum. */
  async setPlaybackDecision(
    versionId: string,
    mode: 'ORIGINAL' | 'REMUX' | 'TRANSCODE',
    reason: string,
  ): Promise<void> {
    await this.db
      .update(videoVersions)
      .set({ playbackMode: mode, playbackReason: reason.slice(0, 500) })
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
        hlsKey: outputs.hlsKey,
        hlsVariants: outputs.hlsVariants,
        updatedAt: new Date(),
      })
      .where(eq(videoVersions.id, versionId));
    await this.meldeFassung(versionId);
  }

  /**
   * Die HLS-Stufenleiter nachtragen (Phase 19). Sie entsteht als eigener
   * Auftrag, lange nachdem die Fassung fertig gemeldet wurde – deshalb ein
   * eigener Schreibvorgang statt eines Feldes in `markReady`.
   */
  async setHls(versionId: string, hlsKey: string, variants: string): Promise<void> {
    await this.db
      .update(videoVersions)
      .set({ hlsKey, hlsVariants: variants, updatedAt: new Date() })
      .where(eq(videoVersions.id, versionId));
    await this.meldeFassung(versionId);
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
    await this.meldeFassung(versionId);
  }

  async setStatus(versionId: string, status: VersionStatus): Promise<void> {
    await this.db
      .update(videoVersions)
      .set({ status, updatedAt: new Date() })
      .where(eq(videoVersions.id, versionId));
    await this.meldeFassung(versionId);
  }

  async update(
    versionId: string,
    changes: {
      label?: string | null;
      downloadEnabled?: boolean;
      fileDate?: string;
      isFinal?: boolean;
    },
    scope: AccessScope,
  ): Promise<VersionDto> {
    const [row] = await this.db
      .update(videoVersions)
      .set({
        label: changes.label,
        downloadEnabled: changes.downloadEnabled,
        fileDate: changes.fileDate,
        isFinal: changes.isFinal,
        updatedAt: new Date(),
      })
      .where(eq(videoVersions.id, versionId))
      .returning();
    if (!row) throw new NotFoundException('Version nicht gefunden.');
    return this.findOneOrFail(row.id, scope);
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

  toDto(row: VersionQueryRow, canDownload: boolean): VersionDto {
    const version = row.version;
    const frameRate =
      version.fpsNum && version.fpsDen ? { num: version.fpsNum, den: version.fpsDen } : null;

    return {
      id: version.id,
      videoId: version.videoId,
      versionNumber: Number(version.versionNumber),
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
      downloadEnabled: version.downloadEnabled,
      isFinal: version.isFinal,
      canDownload,
      playbackMode: version.playbackMode,
      playbackReason: version.playbackReason,
      fileDate: fileDateFromIso(version.fileDate),
      hlsVariants: version.hlsVariants ? version.hlsVariants.split(',').filter(Boolean) : [],
      downloadFilename: buildDownloadFilename({
        date: fileDateFromIso(version.fileDate),
        customer: row.projectCustomer ?? null,
        projectName: row.projectName ?? 'Projekt',
        videoName: row.videoName ?? 'Video',
        versionNumber: Number(version.versionNumber),
        isFinal: version.isFinal,
        resolution: resolutionLabel(version.width, version.height, frameRate),
        extension: extensionOf(version.originalFilename),
      }),
    };
  }
}
