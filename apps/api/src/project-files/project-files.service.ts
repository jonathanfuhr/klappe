import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectFileDto } from '@klappe/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { AccessScope } from '../access/access.service';
import { AccessService } from '../access/access.service';
import { DB, type Database } from '../db/db.module';
import { type ProjectFileRow, projectFiles, users } from '../db/schema';
import { StorageService } from '../storage/storage.service';

/**
 * Der Kunden-Upload-Ordner eines Projekts (Phase 7).
 *
 * Das Material wird nicht transcodiert – es ist Rohmaterial für die
 * Produktion, kein Review-Gegenstand. Wer es sehen darf, ist scharf getrennt:
 * Das Team sieht den ganzen Ordner, ein Gast nur, was er selbst hochgeladen
 * hat. Sonst könnten sich zwei Kunden am selben Projekt gegenseitig in die
 * Dateien schauen.
 */
@Injectable()
export class ProjectFilesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly accessService: AccessService,
    private readonly storage: StorageService,
  ) {}

  async listForProject(
    projectId: string,
    scope: AccessScope,
    user: { id: string },
  ): Promise<ProjectFileDto[]> {
    this.accessService.assertCanViewProject(scope, projectId);

    const rows = await this.db
      .select({
        file: projectFiles,
        uploaderId: users.id,
        uploaderName: users.name,
        uploaderEmail: users.email,
      })
      .from(projectFiles)
      .leftJoin(users, eq(projectFiles.uploadedById, users.id))
      .where(
        scope.unrestricted
          ? eq(projectFiles.projectId, projectId)
          : and(eq(projectFiles.projectId, projectId), eq(projectFiles.uploadedById, user.id)),
      )
      .orderBy(desc(projectFiles.createdAt));

    return rows.map((row) => this.toDto(row));
  }

  async countForProject(projectId: string): Promise<number> {
    const rows = await this.db
      .select({ id: projectFiles.id })
      .from(projectFiles)
      .where(eq(projectFiles.projectId, projectId));
    return rows.length;
  }

  async findOneOrFail(id: string): Promise<ProjectFileRow> {
    const [row] = await this.db.select().from(projectFiles).where(eq(projectFiles.id, id)).limit(1);
    if (!row) throw new NotFoundException('Datei nicht gefunden.');
    return row;
  }

  /** Prüft, ob der Anfragende diese Datei sehen darf. */
  async requireReadable(
    id: string,
    scope: AccessScope,
    user: { id: string },
  ): Promise<ProjectFileRow> {
    const row = await this.findOneOrFail(id);
    this.accessService.assertCanViewProject(scope, row.projectId);
    if (!scope.unrestricted && row.uploadedById !== user.id) {
      throw new NotFoundException('Datei nicht gefunden.');
    }
    return row;
  }

  async create(input: {
    projectId: string;
    uploadedById: string;
    shareLinkId: string | null;
    filename: string;
    sizeBytes: number;
    mimeType: string | null;
    storageKey: string;
  }): Promise<ProjectFileRow> {
    const [row] = await this.db.insert(projectFiles).values(input).returning();
    return row;
  }

  /** Löschen darf nur das Team – Kundenmaterial verschwindet nicht von selbst. */
  async remove(id: string): Promise<void> {
    const row = await this.findOneOrFail(id);
    await this.db.delete(projectFiles).where(eq(projectFiles.id, id));
    await this.storage.remove(row.storageKey);
  }

  toDto(row: {
    file: ProjectFileRow;
    uploaderId: string | null;
    uploaderName: string | null;
    uploaderEmail: string | null;
  }): ProjectFileDto {
    return {
      id: row.file.id,
      projectId: row.file.projectId,
      filename: row.file.filename,
      sizeBytes: row.file.sizeBytes,
      mimeType: row.file.mimeType,
      note: row.file.note,
      uploadedBy:
        row.uploaderId && row.uploaderName && row.uploaderEmail
          ? { id: row.uploaderId, name: row.uploaderName, email: row.uploaderEmail }
          : null,
      createdAt: row.file.createdAt.toISOString(),
    };
  }
}
