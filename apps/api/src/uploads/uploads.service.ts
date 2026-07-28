import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { UploadSessionDto } from '@klappe/shared';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { RequestUser } from '../auth/auth.types';
import { sanitizeFilename } from '../common/normalize';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { type UploadRow, uploads, videoVersions, videos } from '../db/schema';
import { ProjectFilesService } from '../project-files/project-files.service';
import { ProjectsService } from '../projects/projects.service';
import { MailQueueService } from '../queue/mail-queue.service';
import { TranscodeQueueService } from '../queue/transcode-queue.service';
import { StorageService } from '../storage/storage.service';
import { VersionsService } from '../versions/versions.service';
import { VideosService } from '../videos/videos.service';
import { ByteLimitExceededError, LimitStream } from './limit-stream';
import { checkOffset } from './tus';

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  /**
   * Läuft gerade ein `PATCH` für diese Sitzung? Zwei gleichzeitige Schreiber
   * auf dieselbe Datei würden den Offset zerstören, deshalb darf immer nur
   * einer ran. Der Workspace läuft laut Konzept in genau einem Container –
   * ein prozessweites Schloss reicht dafür.
   */
  private readonly active = new Set<string>();

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly storage: StorageService,
    private readonly versionsService: VersionsService,
    private readonly videosService: VideosService,
    private readonly projectsService: ProjectsService,
    private readonly projectFilesService: ProjectFilesService,
    private readonly queue: TranscodeQueueService,
    private readonly mailQueue: MailQueueService,
  ) {}

  /** Neue Fassung eines Videos hochladen. */
  async create(input: {
    videoId: string;
    filename: string;
    sizeBytes: number;
    mimeType: string | null;
    label: string | null;
    fileDate: string | null;
    user: RequestUser;
  }): Promise<UploadSessionDto> {
    this.assertSize(input.sizeBytes);
    await this.videosService.assertExists(input.videoId);

    const version = await this.versionsService.createNextVersion({
      videoId: input.videoId,
      filename: input.filename,
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      label: input.label,
      fileDate: input.fileDate,
      user: input.user,
    });

    const [row] = await this.db
      .insert(uploads)
      .values({
        kind: 'VERSION',
        videoId: input.videoId,
        versionId: version.id,
        createdById: input.user.id,
        filename: input.filename,
        sizeBytes: input.sizeBytes,
        storageKey: '',
        expiresAt: new Date(Date.now() + this.config.uploads.ttlSeconds * 1000),
        metadata: input.mimeType ? { filetype: input.mimeType } : null,
      })
      .returning();

    // Der Ablage-Schlüssel enthält die Upload-ID, die erst nach dem Insert
    // feststeht – deshalb wird er direkt danach nachgetragen.
    const storageKey = this.storage.keyForUploadPart(row.id);
    const [withKey] = await this.db
      .update(uploads)
      .set({ storageKey })
      .where(eq(uploads.id, row.id))
      .returning();

    return this.toDto(withKey);
  }

  /**
   * Datei in den Kunden-Ordner eines Projekts hochladen (Phase 7).
   * Dieselbe Mechanik wie beim Video-Upload, nur ohne Version und ohne
   * Transcoding – es ist Rohmaterial, kein Review-Gegenstand.
   */
  async createProjectFileUpload(input: {
    projectId: string;
    filename: string;
    sizeBytes: number;
    mimeType: string | null;
    shareLinkId: string | null;
    user: RequestUser;
  }): Promise<UploadSessionDto> {
    this.assertSize(input.sizeBytes);
    await this.projectsService.assertExists(input.projectId);

    const [row] = await this.db
      .insert(uploads)
      .values({
        kind: 'PROJECT_FILE',
        projectId: input.projectId,
        createdById: input.user.id,
        filename: input.filename,
        sizeBytes: input.sizeBytes,
        storageKey: '',
        expiresAt: new Date(Date.now() + this.config.uploads.ttlSeconds * 1000),
        metadata: {
          ...(input.mimeType ? { filetype: input.mimeType } : {}),
          ...(input.shareLinkId ? { shareLinkId: input.shareLinkId } : {}),
        },
      })
      .returning();

    const storageKey = this.storage.keyForUploadPart(row.id);
    const [withKey] = await this.db
      .update(uploads)
      .set({ storageKey })
      .where(eq(uploads.id, row.id))
      .returning();

    return this.toDto(withKey);
  }

  private assertSize(sizeBytes: number): void {
    if (sizeBytes <= 0) {
      throw new BadRequestException('Die Dateigröße muss größer als 0 sein.');
    }
    if (sizeBytes > this.config.uploads.maxBytes) {
      throw new PayloadTooLargeException(
        `Die Datei ist größer als das erlaubte Maximum von ${this.config.uploads.maxBytes} Byte.`,
      );
    }
  }

  async getOrFail(id: string): Promise<UploadRow> {
    const [row] = await this.db.select().from(uploads).where(eq(uploads.id, id)).limit(1);
    if (!row) throw new NotFoundException('Upload-Sitzung nicht gefunden.');
    return row;
  }

  /**
   * An einer Upload-Sitzung darf nur weiterschreiben, wer sie angelegt hat –
   * oder das Team. Ohne diese Prüfung könnte ein Gast mit einer fremden
   * Sitzungs-ID in einen anderen Upload hineinschreiben.
   */
  async getWritableOrFail(id: string, user: RequestUser): Promise<UploadRow> {
    const row = await this.getOrFail(id);
    if (user.role === 'GUEST' && row.createdById !== user.id) {
      throw new NotFoundException('Upload-Sitzung nicht gefunden.');
    }
    return row;
  }

  /**
   * Nimmt einen Chunk entgegen. Der Rückgabewert ist der neue Offset, den der
   * Client als `Upload-Offset` zurückbekommt.
   */
  async appendChunk(input: {
    uploadId: string;
    clientOffset: number;
    body: Readable;
    contentLength: number | null;
    user: RequestUser;
  }): Promise<{ offset: number; completed: boolean; row: UploadRow }> {
    const row = await this.getWritableOrFail(input.uploadId, input.user);

    if (row.status === 'ABORTED') {
      throw new NotFoundException('Diese Upload-Sitzung wurde abgebrochen.');
    }
    if (row.status === 'COMPLETED') {
      throw new ConflictException('Dieser Upload ist bereits abgeschlossen.');
    }

    // Die Datei auf der Platte ist die Wahrheit: Wenn ein früherer Versuch
    // mitten im Schreiben abgerissen ist, kann der gespeicherte Offset
    // zurückliegen. Dann korrigieren wir ihn, bevor wir vergleichen.
    const realSize = await this.storage.size(row.storageKey);
    if (realSize !== row.offsetBytes) {
      this.logger.warn(
        `Offset für Upload ${row.id} korrigiert: ${row.offsetBytes} → ${realSize} (Stand auf der Platte).`,
      );
      await this.setOffset(row.id, realSize);
      row.offsetBytes = realSize;
    }

    const check = checkOffset(input.clientOffset, row.offsetBytes, row.sizeBytes);
    if (!check.ok) {
      if (check.reason === 'already-complete') {
        throw new ConflictException('Dieser Upload ist bereits vollständig.');
      }
      throw new ConflictException(
        `Der Offset passt nicht. Der Server steht bei ${row.offsetBytes} Byte.`,
      );
    }

    if (input.contentLength !== null && input.contentLength > check.remaining) {
      throw new PayloadTooLargeException('Der Chunk ist größer als der verbleibende Rest.');
    }

    if (this.active.has(row.id)) {
      throw new ConflictException('Für diesen Upload läuft bereits eine Übertragung.');
    }
    this.active.add(row.id);

    const limiter = new LimitStream(check.remaining);
    let offset = row.offsetBytes;
    try {
      const target = await this.storage.createAppendStream(row.storageKey);
      await pipeline(input.body, limiter, target);
      offset = await this.storage.size(row.storageKey);
    } catch (error) {
      // Auch bei Abbruch liegen die bis dahin geschriebenen Bytes auf der
      // Platte – der Offset muss sie widerspiegeln, sonst verliert der
      // Client beim Fortsetzen genau diesen Teil.
      offset = await this.storage.size(row.storageKey);
      await this.setOffset(row.id, offset);
      if (error instanceof ByteLimitExceededError) {
        throw new PayloadTooLargeException(error.message);
      }

      // Ein abgerissener Client ist Alltag und braucht keinen Eintrag mit
      // Stapelspur. Alles andere – volle Platte, fehlende Rechte, defekter
      // Datenträger – ist ein Betriebsproblem und darf nicht verschwiegen
      // werden: Ohne diese Zeile sucht man nach „Übertragung unterbrochen“ und
      // findet nie den eigentlichen Grund.
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      const abgerissen = code === 'ECONNRESET' || code === 'ERR_STREAM_PREMATURE_CLOSE';
      if (abgerissen) {
        this.logger.warn(
          `Upload ${row.id}: Verbindung bei ${offset} von ${row.sizeBytes} Byte abgerissen (${code}).`,
        );
        throw new BadRequestException('Die Übertragung wurde unterbrochen.');
      }

      this.logger.error(
        `Upload ${row.id} konnte nicht geschrieben werden (${code ?? 'ohne Fehlercode'}): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      // Der Code gehört in die Antwort: `ENOSPC` beantwortet die Frage nach der
      // Ursache sofort, während „unterbrochen“ nur Rätsel aufgibt.
      throw new BadRequestException(
        code
          ? `Der Block ließ sich nicht speichern (${code}).`
          : 'Die Übertragung wurde unterbrochen.',
      );
    } finally {
      this.active.delete(row.id);
    }

    await this.setOffset(row.id, offset);
    row.offsetBytes = offset;

    if (offset >= row.sizeBytes) {
      await this.finalize(row);
      return { offset, completed: true, row };
    }

    return { offset, completed: false, row };
  }

  /** Upload vollständig – je nach Art landet die Datei woanders. */
  private async finalize(row: UploadRow): Promise<void> {
    if (row.kind === 'PROJECT_FILE') {
      await this.finalizeProjectFile(row);
      return;
    }
    await this.finalizeVersion(row);
  }

  /**
   * Datei an ihren endgültigen Platz verschieben, Version auf `PROCESSING`
   * setzen und die Pipeline anstoßen.
   */
  private async finalizeVersion(row: UploadRow): Promise<void> {
    if (!row.versionId) {
      throw new BadRequestException('Zu dieser Upload-Sitzung fehlt die Version.');
    }
    const targetKey = this.storage.keyForOriginal(row.versionId, sanitizeFilename(row.filename));
    await this.storage.move(row.storageKey, targetKey);

    await this.db
      .update(uploads)
      .set({ status: 'COMPLETED', storageKey: targetKey, updatedAt: new Date() })
      .where(eq(uploads.id, row.id));

    await this.versionsService.markUploadComplete(row.versionId, targetKey);

    const [version] = await this.db
      .select({ videoId: videoVersions.videoId })
      .from(videoVersions)
      .where(eq(videoVersions.id, row.versionId))
      .limit(1);
    if (version) {
      const [video] = await this.db
        .select({ projectId: videos.projectId })
        .from(videos)
        .where(eq(videos.id, version.videoId))
        .limit(1);
      if (video) await this.projectsService.touch(video.projectId);
    }

    await this.queue.enqueue(row.versionId);
    this.logger.log(`Upload abgeschlossen: ${row.filename} (${row.sizeBytes} Byte)`);
  }

  /** Kundenmaterial ablegen und das Team benachrichtigen. */
  private async finalizeProjectFile(row: UploadRow): Promise<void> {
    if (!row.projectId) {
      throw new BadRequestException('Zu dieser Upload-Sitzung fehlt das Projekt.');
    }
    const targetKey = this.storage.keyForProjectFile(
      row.projectId,
      row.id,
      sanitizeFilename(row.filename),
    );
    await this.storage.move(row.storageKey, targetKey);

    await this.db
      .update(uploads)
      .set({ status: 'COMPLETED', storageKey: targetKey, updatedAt: new Date() })
      .where(eq(uploads.id, row.id));

    const file = await this.projectFilesService.create({
      projectId: row.projectId,
      uploadedById: row.createdById ?? '',
      shareLinkId: row.metadata?.shareLinkId ?? null,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      mimeType: row.metadata?.filetype ?? null,
      storageKey: targetKey,
    });

    await this.projectsService.touch(row.projectId);
    await this.mailQueue.enqueue({ kind: 'project-file', projectFileId: file.id });
    this.logger.log(`Kunden-Upload abgeschlossen: ${row.filename} (${row.sizeBytes} Byte)`);
  }

  /** Bricht eine Sitzung ab und räumt Teil-Datei und Versionszeile weg. */
  async abort(id: string, user: RequestUser): Promise<void> {
    const row = await this.getWritableOrFail(id, user);
    if (row.status === 'COMPLETED') {
      throw new ConflictException('Ein abgeschlossener Upload kann nicht abgebrochen werden.');
    }

    await this.storage.remove(row.storageKey);
    await this.db.update(uploads).set({ status: 'ABORTED', updatedAt: new Date() }).where(eq(uploads.id, id));
    // Die halb angelegte Version verschwindet mit; beim Kundenmaterial gibt
    // es nichts aufzuräumen, dort entsteht der Datensatz erst am Ende.
    if (row.versionId) {
      await this.db.delete(videoVersions).where(eq(videoVersions.id, row.versionId));
    }
  }

  /**
   * Räumt abgelaufene Sitzungen weg. Läuft stündlich, damit abgebrochene
   * 40-GB-Uploads das Volume nicht dauerhaft belegen.
   */
  async cleanupExpired(): Promise<number> {
    const stale = await this.db
      .select()
      .from(uploads)
      .where(and(eq(uploads.status, 'IN_PROGRESS'), lt(uploads.expiresAt, new Date())));

    for (const row of stale) {
      await this.storage.remove(row.storageKey);
      await this.db
        .update(uploads)
        .set({ status: 'ABORTED', updatedAt: new Date() })
        .where(eq(uploads.id, row.id));
      if (row.versionId) {
        await this.db.delete(videoVersions).where(eq(videoVersions.id, row.versionId));
      }
      this.logger.log(`Abgelaufene Upload-Sitzung aufgeräumt: ${row.id}`);
    }
    return stale.length;
  }

  private async setOffset(id: string, offset: number): Promise<void> {
    await this.db
      .update(uploads)
      .set({ offsetBytes: offset, updatedAt: sql`now()` })
      .where(eq(uploads.id, id));
  }

  toDto(row: UploadRow): UploadSessionDto {
    return {
      id: row.id,
      kind: row.kind,
      videoId: row.videoId,
      versionId: row.versionId,
      projectId: row.projectId,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      offsetBytes: row.offsetBytes,
      status: row.status,
      location: `/v1/uploads/${row.id}`,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }
}
