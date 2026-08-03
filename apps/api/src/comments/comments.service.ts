import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type Annotation,
  type CommentDto,
  type UserRole,
  type UserSummaryDto,
  framesToTimecode,
  mentionedUserIds,
  sanitizeAnnotation,
} from '@klappe/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { AccessService, type AccessScope } from '../access/access.service';
import { AworkNotifyService } from '../awork/awork-notify.service';
import type { RequestUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import {
  type CommentRow,
  commentMentions,
  comments,
  projects,
  users,
  videoVersions,
  videos,
} from '../db/schema';
import { EventsService } from '../events/events.service';
import { MailQueueService } from '../queue/mail-queue.service';
import type { CreateCommentDto, UpdateCommentDto } from './comments.dto';

interface CommentWithAuthor {
  comment: CommentRow;
  authorId: string;
  authorName: string;
  authorEmail: string;
  authorRole: UserRole;
}

@Injectable()
export class CommentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly accessService: AccessService,
    private readonly mailQueue: MailQueueService,
    private readonly events: EventsService,
    private readonly awork: AworkNotifyService,
  ) {}

  /**
   * Alle Kommentare einer Version als Threads: Wurzelkommentare nach Frame
   * sortiert, Antworten chronologisch darunter.
   *
   * Mit `since` kommt nur zurück, was sich seitdem getan hat (Phase 27) – für
   * das „Aktualisieren" einer Anbindung, die die Liste schon einmal geholt
   * hat. Gefiltert wird **ganzen Gesprächen** entlang: Hat sich irgendwo im
   * Faden etwas geändert, kommt er vollständig mit. Eine Antwort ohne ihren
   * Kommentar wäre für den Empfänger nicht einzuordnen.
   *
   * Gelöschte Kommentare fallen wie immer heraus; wer Löschungen erkennen
   * will, braucht die volle Liste.
   */
  async listForVersion(
    versionId: string,
    scope: AccessScope,
    since?: Date,
  ): Promise<CommentDto[]> {
    await this.accessService.requireVersion(scope, versionId);
    const version = await this.getVersionOrFail(versionId);

    const rows = await this.db
      .select({
        comment: comments,
        authorId: users.id,
        authorName: users.name,
        authorEmail: users.email,
        authorRole: users.role,
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(and(eq(comments.versionId, versionId), isNull(comments.deletedAt)))
      .orderBy(asc(comments.createdAt));

    if (rows.length === 0) return [];

    const mentionsByComment = await this.loadMentions(rows.map((row) => row.comment.id));

    const timecodeFor = (frame: number | null): string | null => {
      if (frame === null) return null;
      if (!version.fpsNum || !version.fpsDen) return null;
      return framesToTimecode(
        version.startTimecodeFrames + frame,
        { num: version.fpsNum, den: version.fpsDen },
        version.dropFrame,
      );
    };

    const byId = new Map<string, CommentDto>();
    const roots: CommentDto[] = [];
    /** Fäden, in denen sich seit `since` etwas getan hat. */
    const beruehrt = new Set<string>();

    for (const row of rows) {
      byId.set(
        row.comment.id,
        this.toDto(row, timecodeFor(row.comment.frame), mentionsByComment.get(row.comment.id) ?? []),
      );
      if (since && row.comment.updatedAt > since) {
        beruehrt.add(row.comment.parentId ?? row.comment.id);
      }
    }

    for (const row of rows) {
      const dto = byId.get(row.comment.id);
      if (!dto) continue;
      const parent = row.comment.parentId ? byId.get(row.comment.parentId) : undefined;
      if (parent) {
        parent.replies.push(dto);
      } else if (!since || beruehrt.has(dto.id)) {
        roots.push(dto);
      }
    }

    // Kommentare mit Frame stehen in Timeline-Reihenfolge, allgemeine
    // Anmerkungen ohne Zeitbezug hängen sich hinten an.
    roots.sort((a, b) => {
      if (a.frame === null && b.frame === null) return a.createdAt.localeCompare(b.createdAt);
      if (a.frame === null) return 1;
      if (b.frame === null) return -1;
      if (a.frame !== b.frame) return a.frame - b.frame;
      return a.createdAt.localeCompare(b.createdAt);
    });

    return roots;
  }

  async create(
    versionId: string,
    dto: CreateCommentDto,
    user: RequestUser,
    scope: AccessScope,
  ): Promise<CommentDto> {
    const access = await this.accessService.requireVersion(scope, versionId);
    this.accessService.assertCanComment(scope, { id: access.videoId, projectId: access.projectId });
    // In einem archivierten Projekt ist die Rückmeldung abgeschlossen
    // (Phase 18). Lesen geht weiter, schreiben nicht.
    await this.assertNichtArchiviert(access.projectId);
    const version = await this.getVersionOrFail(versionId);

    let parentId: string | null = null;
    let frame: number | null = dto.frame ?? null;

    if (dto.parentId) {
      const [parent] = await this.db
        .select()
        .from(comments)
        .where(and(eq(comments.id, dto.parentId), isNull(comments.deletedAt)))
        .limit(1);
      if (!parent) throw new NotFoundException('Der Kommentar, auf den geantwortet wird, existiert nicht.');
      if (parent.versionId !== versionId) {
        throw new BadRequestException('Antwort und Kommentar gehören zu verschiedenen Versionen.');
      }
      // Threads bleiben eine Ebene tief: Eine Antwort auf eine Antwort hängt
      // am selben Wurzelkommentar.
      parentId = parent.parentId ?? parent.id;
      frame = null;
    }

    if (frame !== null && version.frameCount !== null && frame >= version.frameCount) {
      throw new BadRequestException(
        `Frame ${frame} liegt hinter dem Ende des Videos (${version.frameCount} Frames).`,
      );
    }

    // Eine Zeichnung ohne Frame hätte keinen Bezugspunkt im Video.
    const annotation = frame === null ? null : sanitizeAnnotation(dto.annotation);

    const [row] = await this.db
      .insert(comments)
      .values({
        versionId,
        parentId,
        authorId: user.id,
        body: dto.body.trim(),
        frame,
        annotation,
      })
      .returning();

    await this.syncMentions(row.id, row.body);
    await this.mailQueue.enqueue({ kind: 'comment', commentId: row.id });
    // Und in die Korrektur-Aufgabe in awork, sofern eingerichtet (Phase 30).
    await this.awork.kommentarGeaendert(versionId);
    // Alle, die dieses Video offen haben, sehen den Kommentar sofort – ohne
    // den Sekundentakt von früher (Phase 18).
    this.events.publish({ topic: 'video', id: access.videoId, projectId: access.projectId });
    return this.findOneOrFail(row.id);
  }

  async update(
    id: string,
    dto: UpdateCommentDto,
    user: RequestUser,
    scope: AccessScope,
  ): Promise<CommentDto> {
    const row = await this.getRowOrFail(id);
    const access = await this.accessService.requireVersion(scope, row.versionId);
    this.assertMayModify(row, user, scope, access.projectId);

    const [updated] = await this.db
      .update(comments)
      .set({
        body: dto.body.trim(),
        annotation:
          dto.annotation === undefined
            ? undefined
            : row.frame === null
              ? null
              : sanitizeAnnotation(dto.annotation),
        editedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(comments.id, id))
      .returning();

    await this.syncMentions(updated.id, updated.body);
    await this.meldeAenderung(updated.versionId);
    return this.findOneOrFail(updated.id);
  }

  /**
   * Weiches Löschen: Antworten und der Bezug zum Frame bleiben erhalten,
   * damit ein Thread nicht auseinanderfällt.
   */
  async remove(id: string, user: RequestUser, scope: AccessScope): Promise<void> {
    const row = await this.getRowOrFail(id);
    const access = await this.accessService.requireVersion(scope, row.versionId);
    this.assertMayModify(row, user, scope, access.projectId);
    await this.db
      .update(comments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(comments.id, id));
    await this.meldeAenderung(row.versionId);
  }

  /**
   * Video und Projekt zur Fassung heraussuchen und die Änderung melden.
   *
   * Seit Phase 30 geht sie auch nach awork: Bearbeitet, gelöscht, abgehakt –
   * die Aufgabenbeschreibung dort entsteht ohnehin komplett neu, es zählt nur,
   * dass überhaupt nachgesehen wird.
   */
  private async meldeAenderung(versionId: string): Promise<void> {
    const [row] = await this.db
      .select({ videoId: videos.id, projectId: videos.projectId })
      .from(videoVersions)
      .innerJoin(videos, eq(videoVersions.videoId, videos.id))
      .where(eq(videoVersions.id, versionId))
      .limit(1);
    if (row) this.events.publish({ topic: 'video', id: row.videoId, projectId: row.projectId });
    await this.awork.kommentarGeaendert(versionId);
  }

  async setResolved(
    id: string,
    resolved: boolean,
    user: RequestUser,
    scope: AccessScope,
  ): Promise<CommentDto> {
    const row = await this.getRowOrFail(id);
    await this.accessService.requireVersion(scope, row.versionId);
    if (row.parentId) {
      throw new BadRequestException('Nur der Wurzelkommentar eines Threads lässt sich erledigen.');
    }
    await this.db
      .update(comments)
      .set({
        resolvedAt: resolved ? new Date() : null,
        resolvedById: resolved ? user.id : null,
        updatedAt: new Date(),
      })
      .where(eq(comments.id, id));
    await this.meldeAenderung(row.versionId);
    return this.findOneOrFail(id);
  }

  /**
   * Zeichnung samt Bildmaßen der Fassung – Grundlage für das gerasterte PNG
   * (Phase 27). Der Zeitstempel geht in den ETag: Die Zeichnung ändert sich
   * nur beim `PATCH` des Kommentars, und genau dann soll ein Zwischenspeicher
   * beim Client verfallen.
   */
  async annotationForRendering(
    id: string,
    scope: AccessScope,
  ): Promise<{
    annotation: Annotation | null;
    media: { width: number | null; height: number | null };
    updatedAt: Date;
  }> {
    const row = await this.getRowOrFail(id);
    await this.accessService.requireVersion(scope, row.versionId);

    const [version] = await this.db
      .select({ width: videoVersions.width, height: videoVersions.height })
      .from(videoVersions)
      .where(eq(videoVersions.id, row.versionId))
      .limit(1);

    return {
      annotation: (row.annotation as Annotation | null) ?? null,
      media: version ?? { width: null, height: null },
      updatedAt: row.updatedAt,
    };
  }

  async findOneOrFail(id: string): Promise<CommentDto> {
    const [row] = await this.db
      .select({
        comment: comments,
        authorId: users.id,
        authorName: users.name,
        authorEmail: users.email,
        authorRole: users.role,
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(eq(comments.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Kommentar nicht gefunden.');

    const version = await this.getVersionOrFail(row.comment.versionId);
    const timecode =
      row.comment.frame !== null && version.fpsNum && version.fpsDen
        ? framesToTimecode(
            version.startTimecodeFrames + row.comment.frame,
            { num: version.fpsNum, den: version.fpsDen },
            version.dropFrame,
          )
        : null;

    const mentions = await this.loadMentions([id]);
    return this.toDto(row, timecode, mentions.get(id) ?? []);
  }

  /**
   * Mentions aus dem Text ziehen und die Zuordnung neu setzen. Nur aktive
   * Konten zählen – so entstehen keine Benachrichtigungen an gesperrte Nutzer.
   */
  private async syncMentions(commentId: string, body: string): Promise<void> {
    await this.db.delete(commentMentions).where(eq(commentMentions.commentId, commentId));

    const ids = mentionedUserIds(body);
    if (ids.length === 0) return;

    const valid = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.isActive, true)));
    if (valid.length === 0) return;

    await this.db
      .insert(commentMentions)
      .values(valid.map((user) => ({ commentId, userId: user.id })))
      .onConflictDoNothing();
  }

  private async loadMentions(commentIds: string[]): Promise<Map<string, UserSummaryDto[]>> {
    const result = new Map<string, UserSummaryDto[]>();
    if (commentIds.length === 0) return result;

    const rows = await this.db
      .select({
        commentId: commentMentions.commentId,
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      })
      .from(commentMentions)
      .innerJoin(users, eq(commentMentions.userId, users.id))
      .where(inArray(commentMentions.commentId, commentIds));

    for (const row of rows) {
      const list = result.get(row.commentId) ?? [];
      list.push({ id: row.id, name: row.name, email: row.email, role: row.role });
      result.set(row.commentId, list);
    }
    return result;
  }

  private async getRowOrFail(id: string): Promise<CommentRow> {
    const [row] = await this.db
      .select()
      .from(comments)
      .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Kommentar nicht gefunden.');
    return row;
  }

  /**
   * In einem archivierten Projekt ist die Rückmeldung abgeschlossen: Ansehen
   * ja, kommentieren nein (Phase 18). Wer es doch versucht, bekommt eine
   * Erklärung statt eines nackten „verboten".
   */
  private async assertNichtArchiviert(projectId: string): Promise<void> {
    const [row] = await this.db
      .select({ archivedAt: projects.archivedAt })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (row?.archivedAt) {
      throw new ForbiddenException(
        'Dieses Projekt ist archiviert – es lässt sich noch ansehen, aber nicht mehr kommentieren.',
      );
    }
  }

  private async getVersionOrFail(versionId: string) {
    const [version] = await this.db
      .select({
        id: videoVersions.id,
        fpsNum: videoVersions.fpsNum,
        fpsDen: videoVersions.fpsDen,
        dropFrame: videoVersions.dropFrame,
        startTimecodeFrames: videoVersions.startTimecodeFrames,
        frameCount: videoVersions.frameCount,
      })
      .from(videoVersions)
      .where(eq(videoVersions.id, versionId))
      .limit(1);
    if (!version) throw new NotFoundException('Version nicht gefunden.');
    return version;
  }

  /**
   * Ändern und Löschen darf der Verfasser, ein Admin zum Aufräumen – und seit
   * Phase 21 ein externer Projektadmin, für genau das Projekt, in dem der
   * Kommentar steht.
   */
  private assertMayModify(
    row: CommentRow,
    user: RequestUser,
    scope: AccessScope,
    projectId: string,
  ): void {
    if (row.authorId === user.id) return;
    if (user.role === 'ADMIN') return;
    if (this.accessService.canManageProject(scope, projectId)) return;
    throw new ForbiddenException('Nur der Verfasser kann diesen Kommentar ändern.');
  }

  private toDto(
    row: CommentWithAuthor,
    timecode: string | null,
    mentions: UserSummaryDto[],
  ): CommentDto {
    return {
      id: row.comment.id,
      versionId: row.comment.versionId,
      parentId: row.comment.parentId,
      author: {
        id: row.authorId,
        name: row.authorName,
        email: row.authorEmail,
        role: row.authorRole,
      },
      body: row.comment.body,
      frame: row.comment.frame,
      timecode,
      annotation: (row.comment.annotation as Annotation | null) ?? null,
      resolvedAt: row.comment.resolvedAt?.toISOString() ?? null,
      createdAt: row.comment.createdAt.toISOString(),
      updatedAt: row.comment.updatedAt.toISOString(),
      editedAt: row.comment.editedAt?.toISOString() ?? null,
      mentions,
      replies: [],
    };
  }
}
