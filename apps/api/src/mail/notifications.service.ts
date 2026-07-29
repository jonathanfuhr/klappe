import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  commentBodyToPlainText,
  framesToTimecode,
  versionLabel as versionNumberLabel,
} from '@klappe/shared';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import {
  commentMentions,
  comments,
  pendingNotifications,
  projectFiles,
  projects,
  users,
  videoVersions,
  videos,
} from '../db/schema';
import { MailQueueService } from '../queue/mail-queue.service';
import { SettingsService } from '../settings/settings.service';
import { decideDigest } from './digest';
import { MailService } from './mail.service';
import {
  type NotificationCandidate,
  formatBytes,
  selectCommentRecipients,
  selectTeamRecipients,
} from './recipients';
import {
  type CommentDigestEntry,
  renderCommentDigestMail,
  renderCommentMail,
  renderProjectFileMail,
} from './templates';

/**
 * Baut die Benachrichtigungen zusammen und verschickt sie. Läuft im
 * Worker-Prozess, angestoßen über die Warteschlange.
 *
 * Seit Phase 18 in zwei Schritten: Ein neuer Kommentar wird je Empfänger nur
 * vorgemerkt (`notifyNewComment`), und erst wenn eine Weile Ruhe war, geht
 * eine Sammelmail raus (`flushDigest`). Wer die Ruhezeit auf 0 stellt, bekommt
 * das alte Verhalten – eine Mail je Kommentar.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly mailService: MailService,
    private readonly settings: SettingsService,
    private readonly mailQueue: MailQueueService,
  ) {}

  async notifyNewComment(commentId: string): Promise<number> {
    if (!(await this.mailService.isReady())) return 0;

    const row = await this.loadComment(commentId);
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

    const minuten = await this.settings.digestMinutes();
    if (minuten <= 0) {
      const brand = await this.mailService.brand();
      let sent = 0;
      for (const recipient of recipients) {
        const mail = renderCommentMail({
          brand,
          recipientName: recipient.name,
          authorName: row.authorName,
          projectName: row.projectName,
          videoName: row.videoName,
          versionLabel: versionLabelOf(row),
          timecode: timecodeOf(row),
          // Ohne das stünde die Auszeichnung samt Benutzerkennung in der Mail.
          body: commentBodyToPlainText(row.comment.body),
          mentioned: recipient.mentioned,
          isReply: row.comment.parentId !== null,
          url: `${this.config.publicUrl}/videos/${row.videoId}`,
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

    // Vormerken statt verschicken. Der Eintrag hält nur fest, *dass* jemand
    // etwas verpasst hat – Text, Timecode und Fassung werden erst beim
    // Versand gelesen, damit eine nachträgliche Änderung noch ankommt.
    await this.db
      .insert(pendingNotifications)
      .values(
        recipients.map((recipient) => ({
          userId: recipient.id,
          commentId,
          videoId: row.videoId,
          mentioned: recipient.mentioned,
        })),
      )
      .onConflictDoNothing();

    for (const recipient of recipients) {
      await this.mailQueue.enqueue(
        { kind: 'digest', userId: recipient.id, videoId: row.videoId },
        minuten * 60_000,
      );
    }

    this.logger.log(
      `${recipients.length} Benachrichtigung(en) zu Kommentar ${commentId} vorgemerkt, Versand in ${minuten} Min.`,
    );
    return 0;
  }

  /**
   * Der zweite Schritt: Was für diese Person und dieses Video wartet, wird zu
   * einer Mail. Kam in der Zwischenzeit ein neuer Kommentar, beginnt die
   * Ruhezeit von vorn – dann übernimmt der Job, der zu diesem Kommentar
   * gehört, und dieser hier geht wieder schlafen.
   */
  async flushDigest(userId: string, videoId: string): Promise<number> {
    if (!(await this.mailService.isReady())) return 0;

    const wartend = await this.db
      .select({
        id: pendingNotifications.id,
        createdAt: pendingNotifications.createdAt,
        mentioned: pendingNotifications.mentioned,
        comment: comments,
        authorName: users.name,
        versionNumber: videoVersions.versionNumber,
        versionLabel: videoVersions.label,
        fpsNum: videoVersions.fpsNum,
        fpsDen: videoVersions.fpsDen,
        dropFrame: videoVersions.dropFrame,
        startTimecodeFrames: videoVersions.startTimecodeFrames,
      })
      .from(pendingNotifications)
      .innerJoin(comments, eq(pendingNotifications.commentId, comments.id))
      .innerJoin(users, eq(comments.authorId, users.id))
      .innerJoin(videoVersions, eq(comments.versionId, videoVersions.id))
      .where(
        and(eq(pendingNotifications.userId, userId), eq(pendingNotifications.videoId, videoId)),
      )
      .orderBy(asc(pendingNotifications.createdAt));

    if (wartend.length === 0) return 0;

    const entscheidung = decideDigest({
      newestAt: wartend.reduce((max, eintrag) => Math.max(max, eintrag.createdAt.getTime()), 0),
      now: Date.now(),
      minutes: await this.settings.digestMinutes(),
    });
    if (!entscheidung.send) {
      await this.mailQueue.enqueue({ kind: 'digest', userId, videoId }, entscheidung.retryInMs);
      return 0;
    }

    const empfaenger = await this.loadRecipient(userId);
    const kopf = await this.loadVideoHead(videoId);
    const ids = wartend.map((eintrag) => eintrag.id);

    // Gelöschte Kommentare fallen aus der Mail, ihre Vormerkung aber trotzdem
    // weg – sonst bliebe sie für immer liegen.
    const sichtbar = wartend.filter((eintrag) => eintrag.comment.deletedAt === null);
    if (!empfaenger || !kopf || sichtbar.length === 0) {
      await this.db.delete(pendingNotifications).where(inArray(pendingNotifications.id, ids));
      return 0;
    }

    const entries: CommentDigestEntry[] = sichtbar.map((eintrag) => ({
      authorName: eintrag.authorName,
      versionLabel: versionLabelOf(eintrag),
      timecode: timecodeOf(eintrag),
      body: commentBodyToPlainText(eintrag.comment.body),
      mentioned: eintrag.mentioned,
    }));

    const brand = await this.mailService.brand();
    const url = `${this.config.publicUrl}/videos/${videoId}`;
    const unsubscribeUrl = this.mailService.unsubscribeUrl(userId);
    const erste = sichtbar[0];

    // Bei genau einem Kommentar bleibt es bei der gewohnten Einzelmail – die
    // sagt „X hat geantwortet“ und liest sich besser als eine Sammlung von
    // einem Stück.
    const mail =
      entries.length === 1
        ? renderCommentMail({
            brand,
            recipientName: empfaenger.name,
            authorName: erste.authorName,
            projectName: kopf.projectName,
            videoName: kopf.videoName,
            versionLabel: entries[0].versionLabel,
            timecode: entries[0].timecode,
            body: entries[0].body,
            mentioned: entries[0].mentioned,
            isReply: erste.comment.parentId !== null,
            url,
            unsubscribeUrl,
          })
        : renderCommentDigestMail({
            brand,
            recipientName: empfaenger.name,
            projectName: kopf.projectName,
            videoName: kopf.videoName,
            entries,
            url,
            unsubscribeUrl,
          });

    // Erst zustellen, dann die Vormerkung löschen: Scheitert der Versand,
    // bleibt sie stehen und der nächste Versuch der Warteschlange bekommt
    // dieselben Kommentare noch einmal zu fassen.
    await this.mailService.send(empfaenger.email, mail);
    await this.db.delete(pendingNotifications).where(inArray(pendingNotifications.id, ids));

    this.logger.log(
      `Sammelmail mit ${entries.length} Kommentar(en) an ${userId} zu Video ${videoId}.`,
    );
    return 1;
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

  private async loadComment(commentId: string) {
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
    return row ?? null;
  }

  /** Video- und Projektname für den Kopf der Sammelmail. */
  private async loadVideoHead(videoId: string) {
    const [row] = await this.db
      .select({ videoName: videos.name, projectName: projects.name })
      .from(videos)
      .innerJoin(projects, eq(videos.projectId, projects.id))
      .where(eq(videos.id, videoId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Der Empfänger, so wie er *jetzt* dasteht: Wer zwischenzeitlich gesperrt
   * wurde oder abbestellt hat, bekommt die wartende Mail nicht mehr.
   */
  private async loadRecipient(userId: string): Promise<NotificationCandidate | null> {
    const [row] = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        notificationsEnabled: users.notificationsEnabled,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!row || !row.isActive || !row.notificationsEnabled) return null;
    return row;
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

/** `v2` oder `v2 – Schnittfassung`, je nachdem, ob die Fassung benannt ist. */
function versionLabelOf(row: { versionNumber: string | number; versionLabel: string | null }): string {
  const nummer = versionNumberLabel(Number(row.versionNumber));
  return row.versionLabel ? `${nummer} – ${row.versionLabel}` : nummer;
}

/**
 * Timecode des Kommentars. `null`, wenn er ohne Zeitbezug geschrieben wurde
 * oder die Bildrate der Fassung (noch) unbekannt ist.
 */
function timecodeOf(row: {
  comment: { frame: number | null };
  fpsNum: number | null;
  fpsDen: number | null;
  dropFrame: boolean;
  startTimecodeFrames: number;
}): string | null {
  if (row.comment.frame === null || !row.fpsNum || !row.fpsDen) return null;
  return framesToTimecode(
    row.startTimecodeFrames + row.comment.frame,
    { num: row.fpsNum, den: row.fpsDen },
    row.dropFrame,
  );
}
