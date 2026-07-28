import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CommentDto,
  type UserSummaryDto,
  framesToTimecode,
  mentionedUserIds,
} from '@klappe/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { RequestUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { type CommentRow, commentMentions, comments, users, videoVersions } from '../db/schema';
import type { CreateCommentDto, UpdateCommentDto } from './comments.dto';

interface CommentWithAuthor {
  comment: CommentRow;
  authorId: string;
  authorName: string;
  authorEmail: string;
}

@Injectable()
export class CommentsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Alle Kommentare einer Version als Threads: Wurzelkommentare nach Frame
   * sortiert, Antworten chronologisch darunter.
   */
  async listForVersion(versionId: string): Promise<CommentDto[]> {
    const version = await this.getVersionOrFail(versionId);

    const rows = await this.db
      .select({
        comment: comments,
        authorId: users.id,
        authorName: users.name,
        authorEmail: users.email,
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

    for (const row of rows) {
      byId.set(
        row.comment.id,
        this.toDto(row, timecodeFor(row.comment.frame), mentionsByComment.get(row.comment.id) ?? []),
      );
    }

    for (const row of rows) {
      const dto = byId.get(row.comment.id);
      if (!dto) continue;
      const parent = row.comment.parentId ? byId.get(row.comment.parentId) : undefined;
      if (parent) {
        parent.replies.push(dto);
      } else {
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

  async create(versionId: string, dto: CreateCommentDto, user: RequestUser): Promise<CommentDto> {
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

    const [row] = await this.db
      .insert(comments)
      .values({
        versionId,
        parentId,
        authorId: user.id,
        body: dto.body.trim(),
        frame,
      })
      .returning();

    await this.syncMentions(row.id, row.body);
    return this.findOneOrFail(row.id);
  }

  async update(id: string, dto: UpdateCommentDto, user: RequestUser): Promise<CommentDto> {
    const row = await this.getRowOrFail(id);
    this.assertMayModify(row, user);

    const [updated] = await this.db
      .update(comments)
      .set({ body: dto.body.trim(), editedAt: new Date(), updatedAt: new Date() })
      .where(eq(comments.id, id))
      .returning();

    await this.syncMentions(updated.id, updated.body);
    return this.findOneOrFail(updated.id);
  }

  /**
   * Weiches Löschen: Antworten und der Bezug zum Frame bleiben erhalten,
   * damit ein Thread nicht auseinanderfällt.
   */
  async remove(id: string, user: RequestUser): Promise<void> {
    const row = await this.getRowOrFail(id);
    this.assertMayModify(row, user);
    await this.db
      .update(comments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(comments.id, id));
  }

  async setResolved(id: string, resolved: boolean, user: RequestUser): Promise<CommentDto> {
    const row = await this.getRowOrFail(id);
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
    return this.findOneOrFail(id);
  }

  async findOneOrFail(id: string): Promise<CommentDto> {
    const [row] = await this.db
      .select({
        comment: comments,
        authorId: users.id,
        authorName: users.name,
        authorEmail: users.email,
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
      })
      .from(commentMentions)
      .innerJoin(users, eq(commentMentions.userId, users.id))
      .where(inArray(commentMentions.commentId, commentIds));

    for (const row of rows) {
      const list = result.get(row.commentId) ?? [];
      list.push({ id: row.id, name: row.name, email: row.email });
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

  /** Ändern und Löschen darf der Verfasser – und Admins zum Aufräumen. */
  private assertMayModify(row: CommentRow, user: RequestUser): void {
    if (row.authorId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('Nur der Verfasser kann diesen Kommentar ändern.');
    }
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
      author: { id: row.authorId, name: row.authorName, email: row.authorEmail },
      body: row.comment.body,
      frame: row.comment.frame,
      timecode,
      resolvedAt: row.comment.resolvedAt?.toISOString() ?? null,
      createdAt: row.comment.createdAt.toISOString(),
      updatedAt: row.comment.updatedAt.toISOString(),
      editedAt: row.comment.editedAt?.toISOString() ?? null,
      mentions,
      replies: [],
    };
  }
}
