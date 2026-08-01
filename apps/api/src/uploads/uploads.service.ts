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
import { type UploadRow, type VideoVersionRow, uploads, videoVersions, videos } from '../db/schema';
import { ProjectFilesService } from '../project-files/project-files.service';
import { ProjectFoldersService } from '../project-files/project-folders.service';
import { ProjectsService } from '../projects/projects.service';
import { MailQueueService } from '../queue/mail-queue.service';
import { TranscodeQueueService } from '../queue/transcode-queue.service';
import { AftercareService } from '../renditions/aftercare.service';
import { StorageService } from '../storage/storage.service';
import { VersionsService } from '../versions/versions.service';
import { VideosService } from '../videos/videos.service';
import { ByteLimitExceededError, LimitStream } from './limit-stream';
import { checkOffset } from './tus';
import { type StoredTranscodeResult, UploadTranscodeService } from './upload-transcode.service';

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
    private readonly projectFoldersService: ProjectFoldersService,
    private readonly queue: TranscodeQueueService,
    private readonly mailQueue: MailQueueService,
    private readonly uploadTranscode: UploadTranscodeService,
    private readonly aftercare: AftercareService,
  ) {
    // Wird die Verarbeitung im Zwischenspeicher fertig, *nachdem* jemand
    // gespeichert hat, muss sie den Umzug selbst anstoßen. Der Rückruf wird
    // hier gesetzt statt umgekehrt eingehängt – sonst zeigten die beiden
    // Dienste im Kreis aufeinander.
    this.uploadTranscode.registerFinishHandler((row) => this.finalizeVersion(row));
  }

  /**
   * Neue Fassung hochladen.
   *
   * `videoId` darf fehlen: Dann läuft die Übertragung schon los, während im
   * Fenster noch Projekt, Video und Datum eingetragen werden. Die Datei liegt
   * so lange im Zwischenspeicher und wird erst mit `assign()` aufgenommen.
   */
  async create(input: {
    videoId: string | null;
    filename: string;
    sizeBytes: number;
    mimeType: string | null;
    label: string | null;
    fileDate: string | null;
    versionNumber: number | null;
    /** Interne Fassung (Phase 27). */
    internal?: boolean;
    /** Vorhandene Fassung gleicher Nummer überschreiben (Phase 27). */
    replace?: boolean;
    user: RequestUser;
  }): Promise<UploadSessionDto> {
    this.assertSize(input.sizeBytes);
    if (input.videoId) await this.videosService.assertExists(input.videoId);
    if (input.replace && input.versionNumber === null) {
      throw new BadRequestException('Zum Ersetzen fehlt die Nummer der Fassung.');
    }

    // Die Nummer wird schon hier geprüft, obwohl die Fassung erst beim
    // Abschluss entsteht: Eine Absage nach 90 GB Übertragung wäre eine
    // Zumutung. Ohne Video lässt sich nichts prüfen – das holt `assign()` nach.
    //
    // Beim Ersetzen fällt die Bestandsprüfung weg: Dort ist eine belegte
    // Nummer gerade der Sinn der Sache (Phase 27).
    if (input.videoId && input.versionNumber !== null) {
      if (input.replace) this.versionsService.assertNumberUsable(input.versionNumber);
      else await this.versionsService.assertNumberFree(input.videoId, input.versionNumber);
    }

    // Die Fassung entsteht bewusst **nicht** hier, sondern erst, wenn die Datei
    // vollständig angekommen ist. Sonst hinterlässt jeder abgebrochene Upload
    // eine Versionsnummer ohne Video – und die nächste echte Fassung bekäme
    // eine Nummer zu viel.
    const [row] = await this.db
      .insert(uploads)
      .values({
        kind: 'VERSION',
        videoId: input.videoId,
        versionId: null,
        createdById: input.user.id,
        filename: input.filename,
        sizeBytes: input.sizeBytes,
        storageKey: '',
        expiresAt: new Date(Date.now() + this.config.uploads.ttlSeconds * 1000),
        // Was die Fassung später ausmacht, wartet hier: Beim Abschluss steht
        // die Upload-Sitzung als Einzige noch zur Verfügung.
        // Die Spalte nimmt nur Zeichenketten – die Nummer wird beim Abschluss
        // zurückgewandelt.
        metadata: {
          ...(input.mimeType ? { filetype: input.mimeType } : {}),
          ...(input.label ? { label: input.label } : {}),
          ...(input.fileDate ? { fileDate: input.fileDate } : {}),
          ...(input.versionNumber !== null ? { versionNumber: String(input.versionNumber) } : {}),
          ...(input.internal ? { internal: '1' } : {}),
          ...(input.replace ? { replace: '1' } : {}),
        },
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
    folderId: string | null;
    filename: string;
    sizeBytes: number;
    mimeType: string | null;
    shareLinkId: string | null;
    user: RequestUser;
  }): Promise<UploadSessionDto> {
    this.assertSize(input.sizeBytes);
    await this.projectsService.assertExists(input.projectId);
    // Ein fremder oder gelöschter Ordner fällt hier auf – nicht erst, wenn die
    // Datei fertig übertragen ist.
    if (input.folderId) {
      await this.projectFoldersService.requireInProject(input.folderId, input.projectId);
    }

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
          ...(input.folderId ? { folderId: input.folderId } : {}),
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

  /**
   * Die eigenen Übertragungen, die vollständig angekommen sind, aber noch auf
   * ihre Zuordnung warten (Phase 15). Damit übersteht die Upload-Liste einen
   * Seiten-Reload: Die Datei liegt ja längst im Zwischenspeicher – nur die
   * Angaben fehlen noch, und die sollen nicht mit dem Tab sterben.
   */
  async listUnassigned(user: RequestUser): Promise<UploadSessionDto[]> {
    const rows = await this.db
      .select()
      .from(uploads)
      .where(
        and(
          eq(uploads.createdById, user.id),
          eq(uploads.kind, 'VERSION'),
          eq(uploads.status, 'IN_PROGRESS'),
          sql`${uploads.videoId} is null`,
          sql`${uploads.offsetBytes} >= ${uploads.sizeBytes}`,
        ),
      )
      .orderBy(uploads.createdAt);
    return rows.map((row) => this.toDto(row));
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
      // Ohne Ziel wird noch nichts aufgenommen: Die Datei wartet im
      // Zwischenspeicher, bis die Zuordnung steht. `assign()` schließt dann ab.
      //
      // Verarbeitet wird sie aber schon (Phase 18) – wer beim Hochladen erst
      // überlegt, soll danach nicht noch einmal die volle Transcode-Zeit
      // warten.
      if (row.kind === 'VERSION' && !row.videoId) {
        await this.starteVerarbeitung(row);
        const [frisch] = await this.db.select().from(uploads).where(eq(uploads.id, row.id)).limit(1);
        return { offset, completed: true, row: frisch ?? row };
      }
      await this.finalize(row);
      // Die Fassung entsteht erst im Abschluss – ohne dieses Nachlesen stünde
      // in der Antwort noch die leere Version von vorhin, und die Oberfläche
      // wüsste nicht, wohin sie verweisen soll.
      const [frisch] = await this.db.select().from(uploads).where(eq(uploads.id, row.id)).limit(1);
      return { offset, completed: true, row: frisch ?? row };
    }

    return { offset, completed: false, row };
  }

  /**
   * Verarbeitung im Zwischenspeicher anstoßen (Phase 18) – für eine Datei,
   * die vollständig da ist, aber noch kein Ziel hat.
   */
  private async starteVerarbeitung(row: UploadRow): Promise<void> {
    if (row.transcodeStatus !== 'NONE') return;
    await this.db
      .update(uploads)
      .set({ transcodeStatus: 'PROCESSING', transcodeProgress: 0, updatedAt: new Date() })
      .where(eq(uploads.id, row.id));
    await this.queue.enqueueUpload(row.id);
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
   * Die Datei an ihren endgültigen Platz bringen und die Fassung fertigstellen.
   *
   * Seit Phase 18 ist die Verarbeitung an dieser Stelle oft schon gelaufen –
   * sie startet, sobald die Datei vollständig übertragen ist, und arbeitet im
   * Zwischenspeicher. Dann zieht hier alles nur noch um und die Fassung ist
   * sofort fertig. Läuft sie noch, entsteht die Fassung in Verarbeitung und
   * der Umzug kommt hinterher – wer als Zweiter fertig wird, macht ihn.
   */
  private async finalizeVersion(row: UploadRow): Promise<void> {
    if (!row.videoId) {
      throw new BadRequestException('Zu dieser Upload-Sitzung fehlt das Video.');
    }

    // Erst jetzt bekommt die Fassung ihre Nummer – die Datei ist vollständig da.
    const roh = (row.metadata ?? {}) as Record<string, string | undefined>;
    const details = {
      filetype: roh.filetype,
      label: roh.label,
      fileDate: roh.fileDate,
      versionNumber: roh.versionNumber === undefined ? undefined : Number(roh.versionNumber),
      internal: roh.internal === '1',
      replace: roh.replace === '1',
    };
    const angelegt = row.versionId ? null : await this.createVersionFor(row, details);
    const versionId = row.versionId ?? (angelegt as { id: string }).id;

    const targetKey = this.storage.keyForOriginal(versionId, sanitizeFilename(row.filename));
    await this.storage.move(row.storageKey, targetKey);

    await this.db
      .update(uploads)
      .set({ status: 'COMPLETED', storageKey: targetKey, versionId, updatedAt: new Date() })
      .where(eq(uploads.id, row.id));

    await this.versionsService.markUploadComplete(versionId, targetKey);

    // Die ersetzte Fassung ist samt Kommentaren aus der Datenbank verschwunden
    // (Phase 27) – ihre Dateien liegen aber noch auf der Platte. Erst jetzt,
    // nach dem Umzug, ist Zeit dafür: Scheitert vorher etwas, steht die alte
    // Fassung wenigstens noch komplett da.
    if (angelegt?.ersetzt) await this.entferneDateien(angelegt.ersetzt);

    const [version] = await this.db
      .select({ videoId: videoVersions.videoId })
      .from(videoVersions)
      .where(eq(videoVersions.id, versionId))
      .limit(1);
    if (version) {
      const [video] = await this.db
        .select({ projectId: videos.projectId })
        .from(videos)
        .where(eq(videos.id, version.videoId))
        .limit(1);
      if (video) await this.projectsService.touch(video.projectId);
    }

    const fertig = this.uploadTranscode.result(row);
    if (fertig) {
      await this.uebernehmeVerarbeitung(row, versionId, targetKey, fertig);
      this.logger.log(`Upload aufgenommen, Verarbeitung lag schon vor: ${row.filename}`);
      return;
    }

    if (row.transcodeStatus === 'PROCESSING') {
      // Sie läuft noch. Der Job trägt am Ende selbst ein – hier nichts tun,
      // sonst liefen zwei ffmpeg-Durchläufe für dieselbe Datei.
      this.logger.log(`Upload aufgenommen, Verarbeitung läuft noch: ${row.filename}`);
      return;
    }

    // Kein Ergebnis und nichts unterwegs (etwa nach einem Fehlschlag oder bei
    // einer Sitzung von vor Phase 18): der gewohnte Weg über die Fassung.
    await this.queue.enqueue(versionId);
    this.logger.log(`Upload abgeschlossen: ${row.filename} (${row.sizeBytes} Byte)`);
  }

  /**
   * Die im Zwischenspeicher erzeugten Dateien an ihren Platz schieben und die
   * Fassung damit fertig melden. Ein zweiter ffmpeg-Lauf wäre reine
   * Verschwendung – die Arbeit ist längst getan.
   */
  private async uebernehmeVerarbeitung(
    row: UploadRow,
    versionId: string,
    originalKey: string,
    ergebnis: StoredTranscodeResult,
  ): Promise<void> {
    await this.versionsService.applyProbe(versionId, ergebnis.probe);
    await this.versionsService.setPlaybackDecision(
      versionId,
      ergebnis.playbackMode,
      ergebnis.playbackReason,
    );

    const outputs = { ...ergebnis.outputs };

    // Bei `ORIGINAL` zeigt der Proxy auf die Originaldatei – die ist gerade
    // umgezogen, der Schlüssel muss mitziehen.
    if (ergebnis.playbackMode === 'ORIGINAL') {
      outputs.proxyKey = originalKey;
    } else {
      const ziel = this.storage.keyForProxy(versionId);
      await this.storage.move(outputs.proxyKey, ziel);
      outputs.proxyKey = ziel;
    }

    if (outputs.posterKey) {
      const ziel = this.storage.keyForPoster(versionId);
      await this.storage.move(outputs.posterKey, ziel);
      outputs.posterKey = ziel;
    }

    if (outputs.sprite) {
      const ziel = this.storage.keyForSprite(versionId);
      await this.storage.move(outputs.sprite.key, ziel);
      outputs.sprite = { ...outputs.sprite, key: ziel };
    }

    // Seit Phase 19 entsteht die HLS-Leiter als eigener Auftrag an der
    // fertigen Fassung, hier also nichts mehr. Der Zweig bleibt für Ergebnisse
    // stehen, die noch vom alten Weg im Zwischenspeicher liegen – etwa wenn
    // der Container mitten in einer Sitzung aktualisiert wurde.
    if (outputs.hlsKey) {
      const ziel = this.storage.keyForHlsDir(versionId);
      await this.storage.move(outputs.hlsKey, ziel);
      outputs.hlsKey = ziel;
    }

    await this.versionsService.markReady(versionId, outputs);
    await this.uploadTranscode.removeWorkDir(row.id);
    await this.aftercare.scheduleQuietly(versionId);
  }

  /**
   * Die Fassung zum abgeschlossenen Upload. Ist die gewünschte Nummer
   * inzwischen von jemand anderem vergeben worden, zählt Klappe selbst weiter,
   * statt eine fertig übertragene Datei wegzuwerfen.
   */
  private async createVersionFor(
    row: UploadRow,
    details: {
      filetype?: string;
      label?: string;
      fileDate?: string;
      versionNumber?: number;
      internal?: boolean;
      replace?: boolean;
    },
  ): Promise<{ id: string; ersetzt: VideoVersionRow | null }> {
    const gemeinsam = {
      videoId: row.videoId as string,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      mimeType: details.filetype ?? null,
      label: details.label ?? null,
      fileDate: details.fileDate ?? null,
      internal: details.internal ?? false,
      user: { id: row.createdById } as RequestUser,
    };

    // Ersetzen (Phase 27): Die Nummer *soll* belegt sein, und die alte Fassung
    // weicht in derselben Transaktion. Hier gibt es kein Weiterzählen als
    // Ausweg – wer ersetzen wollte, will keine v4.
    if (details.replace && details.versionNumber !== undefined) {
      const ergebnis = await this.versionsService.replaceVersion({
        ...gemeinsam,
        versionNumber: details.versionNumber,
      });
      if (ergebnis.ersetzt) {
        this.logger.log(
          `Fassung ${details.versionNumber} von Video ${row.videoId} ersetzt ` +
            `(alte Fassung ${ergebnis.ersetzt.id} samt Kommentaren entfernt).`,
        );
      }
      return { id: ergebnis.row.id, ersetzt: ergebnis.ersetzt };
    }

    if (details.versionNumber === undefined) {
      return { id: (await this.versionsService.createNextVersion(gemeinsam)).id, ersetzt: null };
    }
    try {
      const row2 = await this.versionsService.createNextVersion({
        ...gemeinsam,
        versionNumber: details.versionNumber,
      });
      return { id: row2.id, ersetzt: null };
    } catch (error) {
      this.logger.warn(
        `Wunschnummer ${details.versionNumber} für Upload ${row.id} nicht mehr frei ` +
          `(${error instanceof Error ? error.message : String(error)}) – es wird weitergezählt.`,
      );
      return { id: (await this.versionsService.createNextVersion(gemeinsam)).id, ersetzt: null };
    }
  }

  /** Alles, was zu einer weggefallenen Fassung auf der Platte liegt. */
  private async entferneDateien(version: VideoVersionRow): Promise<void> {
    for (const key of [
      version.originalKey,
      version.proxyKey,
      version.posterKey,
      version.spriteKey,
      version.hlsKey,
    ]) {
      if (key) await this.storage.remove(key);
    }
    // Die erzeugten Download-Formate (Phase 19) liegen je Fassung in einem
    // eigenen Verzeichnis.
    await this.storage.remove(this.storage.keyForRenditionDir(version.id));
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
      folderId: row.metadata?.folderId ?? null,
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
  /**
   * Zuordnung nachreichen und – wenn die Datei schon vollständig da ist –
   * die Fassung anlegen.
   *
   * Das ist die zweite Hälfte des Uploads: Die Bytes fließen bereits, während
   * im Fenster noch Projekt und Video eingetragen werden. Erst hier bekommt
   * die Datei ihr Ziel. Kommt die Zuordnung, bevor die Übertragung fertig ist,
   * wird sie nur vermerkt; der letzte Block schließt dann wie gewohnt ab.
   */
  async assign(
    id: string,
    input: {
      videoId?: string;
      label?: string | null;
      fileDate?: string | null;
      versionNumber?: number | null;
      internal?: boolean;
      replace?: boolean;
    },
    user: RequestUser,
  ): Promise<{ session: UploadSessionDto; versionId: string | null }> {
    const row = await this.getWritableOrFail(id, user);
    if (row.kind !== 'VERSION') {
      throw new BadRequestException('Diese Upload-Sitzung gehört nicht zu einer Fassung.');
    }
    if (row.status === 'ABORTED') throw new NotFoundException('Diese Sitzung wurde abgebrochen.');
    if (row.status === 'COMPLETED') {
      throw new ConflictException('Diese Fassung wurde bereits aufgenommen.');
    }

    const videoId = input.videoId ?? row.videoId;
    if (videoId) await this.videosService.assertExists(videoId);

    // Jetzt lässt sich die Wunschnummer endlich prüfen – vorher war kein Video
    // bekannt, gegen das man sie hätte halten können.
    const bisher = (row.metadata ?? {}) as Record<string, string>;
    const nummer =
      input.versionNumber === undefined
        ? bisher.versionNumber
        : input.versionNumber === null
          ? undefined
          : String(input.versionNumber);
    const ersetzen = input.replace ?? bisher.replace === '1';
    if (ersetzen && nummer === undefined) {
      throw new BadRequestException('Zum Ersetzen fehlt die Nummer der Fassung.');
    }
    if (videoId && nummer !== undefined) {
      if (ersetzen) this.versionsService.assertNumberUsable(Number(nummer));
      else await this.versionsService.assertNumberFree(videoId, Number(nummer));
    }

    const metadata = { ...bisher };
    if (input.label !== undefined) {
      if (input.label) metadata.label = input.label;
      else delete metadata.label;
    }
    if (input.fileDate !== undefined) {
      if (input.fileDate) metadata.fileDate = input.fileDate;
      else delete metadata.fileDate;
    }
    if (input.versionNumber !== undefined) {
      if (input.versionNumber === null) delete metadata.versionNumber;
      else metadata.versionNumber = String(input.versionNumber);
    }
    if (input.internal !== undefined) {
      if (input.internal) metadata.internal = '1';
      else delete metadata.internal;
    }
    if (input.replace !== undefined) {
      if (input.replace) metadata.replace = '1';
      else delete metadata.replace;
    }

    const [aktualisiert] = await this.db
      .update(uploads)
      .set({ videoId: videoId ?? null, metadata, updatedAt: new Date() })
      .where(eq(uploads.id, row.id))
      .returning();

    // Vollständig übertragen und jetzt mit Ziel: aufnehmen.
    if (videoId && aktualisiert.offsetBytes >= aktualisiert.sizeBytes) {
      await this.finalize(aktualisiert);
      const [fertig] = await this.db.select().from(uploads).where(eq(uploads.id, row.id)).limit(1);
      return { session: this.toDto(fertig ?? aktualisiert), versionId: fertig?.versionId ?? null };
    }

    return { session: this.toDto(aktualisiert), versionId: null };
  }

  async abort(id: string, user: RequestUser): Promise<void> {
    const row = await this.getWritableOrFail(id, user);
    if (row.status === 'COMPLETED') {
      throw new ConflictException('Ein abgeschlossener Upload kann nicht abgebrochen werden.');
    }

    await this.storage.remove(row.storageKey);
    // Auch die halbfertige Verarbeitung im Zwischenspeicher muss weg – sonst
    // bliebe ein 4K-Proxy für eine Datei liegen, die es nicht mehr gibt.
    await this.uploadTranscode.removeWorkDir(row.id);
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
      // Samt dem, was die Verarbeitung im Zwischenspeicher erzeugt hat.
      await this.uploadTranscode.removeWorkDir(row.id);
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
      transcodeStatus: row.transcodeStatus,
      transcodeProgress: row.transcodeProgress,
      transcodeError: row.transcodeError,
      internal: (row.metadata as Record<string, string> | null)?.internal === '1',
      location: `/v1/uploads/${row.id}`,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }
}
