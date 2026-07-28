import { Inject, Injectable, Logger } from '@nestjs/common';
import { framesToTimecode, versionLabel as versionNumberLabel } from '@klappe/shared';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import {
  commentMentions,
  comments,
  projectFiles,
  projects,
  users,
  videoVersions,
  videos,
} from '../db/schema';
import { MailService } from './mail.service';
import {
  type NotificationCandidate,
  formatBytes,
  selectCommentRecipients,
  selectTeamRecipients,
} from './recipients';
import { renderCommentMail, renderProjectFileMail } from './templates';

/**
 * Baut die Benachrichtigungen zusammen und verschickt sie. Läuft im
 * Worker-Prozess, angestoßen über die Warteschlange.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly mailService: MailService,
  ) {}

  async notifyNewComment(commentId: string): Promise<number> {
    if (!(await this.mailService.isReady())) return 0;

    const [row] = await this.db
      .select({
        comment: comments,
        authorName: users.name,
        videoId: videos.id,
        videoName: videos.name,
        projectName: projects.name,
        versionNumber: videoVersions.versionNumber,
        versionLabel: videoVersions.label,
        fpsNum: videoVersions.fpsNum,
        fpsDen: videoVersions.fpsDen,
        dropFrame: videoVersions.dropFrame,
        startTimecodeFrames: videoVersions.startTimecodeFrames,
        uploadedById: videoVersions.uploadedById,
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .innerJoin(videoVersions, eq(comments.versionId, videoVersions.id))
      .innerJoin(videos, eq(videoVersions.videoId, videos.id))
      .innerJoin(projects, eq(videos.projectId, projects.id))
      .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)))
      .limit(1);

    if (!row) {
      this.logger.warn(`Kommentar ${commentId} existiert nicht mehr – keine Benachrichtigung.`);
      return 0;
    }

    const mentioned = await this.loadMentioned(commentId);
    const participants = await this.loadCommentParticipants({
      versionId: row.comment.versionId,
      uploadedById: row.uploadedById,
      parentId: row.comment.parentId,
    });

    const recipients = selectCommentRecipients({
      authorId: row.comment.authorId,
      mentioned,
      participants,
    });
    if (recipients.length === 0) return 0;

    const timecode =
      row.comment.frame !== null && row.fpsNum && row.fpsDen
        ? framesToTimecode(
            row.startTimecodeFrames + row.comment.frame,
            { num: row.fpsNum, den: row.fpsDen },
            row.dropFrame,
          )
        : null;

    const url = `${this.config.publicUrl}/videos/${row.videoId}`;
    const nummer = versionNumberLabel(Number(row.versionNumber));
    const versionLabel = row.versionLabel ? `${nummer} – ${row.versionLabel}` : nummer;

    const brand = await this.mailService.brand();
    let sent = 0;
    for (const recipient of recipients) {
      const mail = renderCommentMail({
        brand,
        recipientName: recipient.name,
        authorName: row.authorName,
        projectName: row.projectName,
        videoName: row.videoName,
        versionLabel,
        timecode,
        body: row.comment.body,
        mentioned: recipient.mentioned,
        isReply: row.comment.parentId !== null,
        url,
        unsubscribeUrl: this.mailService.unsubscribeUrl(recipient.id),
      });

      // Ein unzustellbarer Empfänger darf die übrigen nicht mitreißen.
      try {
        await this.mailService.send(recipient.email, mail);
        sent += 1;
      } catch (error) {
        this.logger.warn(`Benachrichtigung an ${recipient.id} fehlgeschlagen: ${String(error)}`);
      }
    }
    return sent;
  }

  async notifyProjectFile(projectFileId: string): Promise<number> {
    if (!(await this.mailService.isReady())) return 0;

    const [row] = await this.db
      .select({
        file: projectFiles,
        projectName: projects.name,
        uploaderName: users.name,
      })
      .from(projectFiles)
      .innerJoin(projects, eq(projectFiles.projectId, projects.id))
      .leftJoin(users, eq(projectFiles.uploadedById, users.id))
      .where(eq(projectFiles.id, projectFileId))
      .limit(1);

    if (!row) return 0;

    // Kundenmaterial geht das Team an – Gäste bekommen davon nichts mit.
    const team = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        notificationsEnabled: users.notificationsEnabled,
      })
      .from(users)
      .where(or(eq(users.role, 'ADMIN'), eq(users.role, 'MEMBER')));

    const recipients = selectTeamRecipients(team, row.file.uploadedById);
    if (recipients.length === 0) return 0;

    const url = `${this.config.publicUrl}/projekte/${row.file.projectId}`;
    const brand = await this.mailService.brand();
    let sent = 0;

    for (const recipient of recipients) {
      const mail = renderProjectFileMail({
        brand,
        recipientName: recipient.name,
        uploaderName: row.uploaderName ?? 'Ein Gast',
        projectName: row.projectName,
        filename: row.file.filename,
        sizeLabel: formatBytes(row.file.sizeBytes),
        url,
        unsubscribeUrl: this.mailService.unsubscribeUrl(recipient.id),
      });

      try {
        await this.mailService.send(recipient.email, mail);
        sent += 1;
      } catch (error) {
        this.logger.warn(`Upload-Hinweis an ${recipient.id} fehlgeschlagen: ${String(error)}`);
      }
    }
    return sent;
  }

  private async loadMentioned(commentId: string): Promise<NotificationCandidate[]> {
    return this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        notificationsEnabled: users.notificationsEnabled,
      })
      .from(commentMentions)
      .innerJoin(users, eq(commentMentions.userId, users.id))
      .where(eq(commentMentions.commentId, commentId));
  }

  /**
   * Beteiligte eines Gesprächs: alle, die zu dieser Fassung schon
   * kommentiert haben, plus die Person, die die Fassung hochgeladen hat.
   */
  private async loadCommentParticipants(input: {
    versionId: string;
    uploadedById: string | null;
    parentId: string | null;
  }): Promise<NotificationCandidate[]> {
    const columns = {
      id: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      notificationsEnabled: users.notificationsEnabled,
    };

    const commenters = await this.db
      .selectDistinctOn([users.id], columns)
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(and(eq(comments.versionId, input.versionId), isNull(comments.deletedAt)));

    const extraIds = [input.uploadedById].filter((id): id is string => Boolean(id));
    const extras = extraIds.length
      ? await this.db.select(columns).from(users).where(inArray(users.id, extraIds))
      : [];

    return [...commenters, ...extras];
  }
}
