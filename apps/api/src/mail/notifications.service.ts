import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type UserRole,
  commentBodyToPlainText,
  framesToTimecode,
  versionLabel as versionNumberLabel,
} from '@klappe/shared';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import {
  commentMentions,
  comments,
  notificationSubscriptions,
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
import { NotificationCenterService } from './notification-center.service';
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
    private readonly center: NotificationCenterService,
  ) {}

  async notifyNewComment(commentId: string): Promise<number> {
    const row = await this.loadComment(commentId);
    if (!row) {
      this.logger.warn(`Kommentar ${commentId} existiert nicht mehr – keine Benachrichtigung.`);
      return 0;
    }

    const mentioned = await this.loadMentioned(commentId);
    const subscribers = await this.loadSubscribers(row.videoId, row.projectId);
    const participants = await this.loadGuestParticipants(row.comment.versionId);

    const recipients = await this.nurTeamBeiIntern(
      row.internal,
      selectCommentRecipients({
        authorId: row.comment.authorId,
        mentioned,
        subscribers,
        participants,
      }),
    );
    if (recipients.length === 0) return 0;

    // Zuerst in die Zentrale, dann erst der Versand: Wer ohne Mailserver
    // arbeitet oder die Mail übersieht, findet den Hinweis trotzdem.
    await this.center.record(commentId, row.videoId, recipients);

    if (!(await this.mailService.isReady())) return 0;

    const minuten = await this.settings.digestMinutes();
    if (minuten <= 0) {
      const brand = await this.mailService.brand();
      let sent = 0;
      for (const recipient of recipients) {
        const mail = renderCommentMail({
          brand,
          locale: await this.mailService.localeFor(recipient.locale),
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
   *
   * Jeder Kommentar reiht einen eigenen Job ein. Werden mehrere zugleich
   * fällig – der Normalfall, wenn in der Ruhezeit mehrfach kommentiert wurde –,
   * kommen sie hier gleichzeitig an. Deshalb greift sich der Job seine Zeilen
   * in **einer** Anweisung (`beanspruche`), bevor er irgendetwas verschickt.
   * Ohne das gingen drei Kommentare als drei identische Mails raus; genau so
   * ist es am 29.07.2026 passiert.
   */
  async flushDigest(userId: string, videoId: string): Promise<number> {
    if (!(await this.mailService.isReady())) return 0;

    // Ist die Ruhezeit überhaupt vorbei? Dafür genügen die Zeitstempel der
    // freien Zeilen – noch ohne etwas anzufassen, sonst müsste ein zu früher
    // Job seine Beanspruchung gleich wieder zurückgeben.
    const offen = await this.db
      .select({ createdAt: pendingNotifications.createdAt })
      .from(pendingNotifications)
      .where(
        and(
          eq(pendingNotifications.userId, userId),
          eq(pendingNotifications.videoId, videoId),
          isNull(pendingNotifications.claimedAt),
        ),
      );
    if (offen.length === 0) return 0;

    const entscheidung = decideDigest({
      newestAt: offen.reduce((max, eintrag) => Math.max(max, eintrag.createdAt.getTime()), 0),
      now: Date.now(),
      minutes: await this.settings.digestMinutes(),
    });
    if (!entscheidung.send) {
      await this.mailQueue.enqueue({ kind: 'digest', userId, videoId }, entscheidung.retryInMs);
      return 0;
    }

    const ids = await this.beanspruche(userId, videoId);
    if (ids.length === 0) return 0;

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
        internal: videoVersions.internal,
      })
      .from(pendingNotifications)
      .innerJoin(comments, eq(pendingNotifications.commentId, comments.id))
      .innerJoin(users, eq(comments.authorId, users.id))
      .innerJoin(videoVersions, eq(comments.versionId, videoVersions.id))
      .where(inArray(pendingNotifications.id, ids))
      .orderBy(asc(pendingNotifications.createdAt));

    if (wartend.length === 0) {
      await this.db.delete(pendingNotifications).where(inArray(pendingNotifications.id, ids));
      return 0;
    }

    const empfaenger = await this.loadRecipient(userId);
    const kopf = await this.loadVideoHead(videoId);

    // Gelöschte Kommentare fallen aus der Mail, ihre Vormerkung aber trotzdem
    // weg – sonst bliebe sie für immer liegen. Dasselbe für Kommentare an
    // einer Fassung, die in der Ruhezeit intern gestellt wurde (Phase 27):
    // Für einen Gast gibt es sie inzwischen nicht mehr.
    const imHaus = empfaenger?.role === 'ADMIN' || empfaenger?.role === 'MEMBER';
    const sichtbar = wartend.filter(
      (eintrag) => eintrag.comment.deletedAt === null && (imHaus || !eintrag.internal),
    );
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
    const sprache = await this.mailService.localeFor(empfaenger.locale);
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
            locale: sprache,
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
            locale: sprache,
            recipientName: empfaenger.name,
            projectName: kopf.projectName,
            videoName: kopf.videoName,
            entries,
            url,
            unsubscribeUrl,
          });

    // Erst zustellen, dann die Vormerkung löschen: Scheitert der Versand,
    // wird die Beanspruchung zurückgegeben und der nächste Versuch der
    // Warteschlange bekommt dieselben Kommentare noch einmal zu fassen.
    try {
      await this.mailService.send(empfaenger.email, mail);
    } catch (error) {
      await this.db
        .update(pendingNotifications)
        .set({ claimedAt: null })
        .where(inArray(pendingNotifications.id, ids));
      throw error;
    }
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
        locale: users.locale,
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
        locale: await this.mailService.localeFor(recipient.locale),
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

  /**
   * Bei einer internen Fassung (Phase 27) bleibt die Benachrichtigung im Haus.
   *
   * Kommentieren kann dort ohnehin nur das Team – die Fassung ist für Gäste ja
   * nicht sichtbar. Ein Gast kann aber **namentlich erwähnt** werden, und dann
   * ginge ohne diese Zeile eine Mail über eine Fassung hinaus, von der der
   * Kunde nichts wissen soll. Mit der Freigabe gelten wieder die gewohnten
   * Abläufe.
   */
  private async nurTeamBeiIntern<T extends { id: string }>(
    intern: boolean,
    empfaenger: T[],
  ): Promise<T[]> {
    if (!intern || empfaenger.length === 0) return empfaenger;

    const team = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(
            users.id,
            empfaenger.map((eintrag) => eintrag.id),
          ),
          or(eq(users.role, 'ADMIN'), eq(users.role, 'MEMBER')),
        ),
      );
    const erlaubt = new Set(team.map((eintrag) => eintrag.id));
    return empfaenger.filter((eintrag) => erlaubt.has(eintrag.id));
  }

  /**
   * Greift sich alles, was für diesen Empfänger und dieses Video wartet – in
   * einer einzigen Anweisung. Kommt ein zweiter Job gleichzeitig hier an,
   * wartet er auf die Zeilensperre und prüft die Bedingung danach erneut:
   * Dann ist `claimed_at` gesetzt und er bekommt nichts. So entsteht weder
   * eine doppelte Mail noch eine zerrissene, bei der sich zwei Jobs die
   * Kommentare teilen.
   *
   * Beansprucht wird auch, was vor einer Viertelstunde beansprucht und nie
   * verschickt wurde – sonst bliebe eine Sammlung nach einem Absturz mitten
   * im Versand für immer liegen.
   */
  private async beanspruche(userId: string, videoId: string): Promise<string[]> {
    const zeilen = await this.db
      .update(pendingNotifications)
      .set({ claimedAt: sql`now()` })
      .where(
        and(
          eq(pendingNotifications.userId, userId),
          eq(pendingNotifications.videoId, videoId),
          or(
            isNull(pendingNotifications.claimedAt),
            sql`${pendingNotifications.claimedAt} < now() - interval '15 minutes'`,
          ),
        ),
      )
      .returning({ id: pendingNotifications.id });
    return zeilen.map((zeile) => zeile.id);
  }

  private async loadComment(commentId: string) {
    const [row] = await this.db
      .select({
        comment: comments,
        authorName: users.name,
        videoId: videos.id,
        videoName: videos.name,
        projectId: projects.id,
        projectName: projects.name,
        versionNumber: videoVersions.versionNumber,
        versionLabel: videoVersions.label,
        fpsNum: videoVersions.fpsNum,
        fpsDen: videoVersions.fpsDen,
        dropFrame: videoVersions.dropFrame,
        startTimecodeFrames: videoVersions.startTimecodeFrames,
        uploadedById: videoVersions.uploadedById,
        internal: videoVersions.internal,
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
  private async loadRecipient(
    userId: string,
  ): Promise<(NotificationCandidate & { role: UserRole }) | null> {
    const [row] = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        notificationsEnabled: users.notificationsEnabled,
        locale: users.locale,
        // Für die Frage, ob interne Fassungen mit in die Sammelmail dürfen.
        role: users.role,
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
        locale: users.locale,
      })
      .from(commentMentions)
      .innerJoin(users, eq(commentMentions.userId, users.id))
      .where(eq(commentMentions.commentId, commentId));
  }

  /**
   * Gäste, die zu dieser Fassung schon kommentiert haben.
   *
   * Sie stehen nicht in der Spalte „Benachrichtigungen“ und können sich dort
   * auch nicht eintragen – die Antwort auf die eigene Anmerkung sollen sie
   * trotzdem bekommen. Fürs Team gilt seit Phase 18 allein die Eintragung:
   * Ein einzelner Kommentar abonniert den Film nicht mehr auf Dauer.
   */
  private async loadGuestParticipants(versionId: string): Promise<NotificationCandidate[]> {
    return this.db
      .selectDistinctOn([users.id], {
        id: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        notificationsEnabled: users.notificationsEnabled,
        locale: users.locale,
      })
      .from(comments)
      .innerJoin(users, eq(comments.authorId, users.id))
      .where(
        and(
          eq(comments.versionId, versionId),
          isNull(comments.deletedAt),
          eq(users.role, 'GUEST'),
        ),
      );
  }

  /**
   * Wer den Film verfolgt: eingetragen am Video oder am ganzen Projekt
   * (Phase 18). Gesperrte Konten fallen schon hier raus.
   */
  private async loadSubscribers(
    videoId: string,
    projectId: string,
  ): Promise<NotificationCandidate[]> {
    return this.db
      .selectDistinctOn([users.id], {
        id: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        notificationsEnabled: users.notificationsEnabled,
        locale: users.locale,
      })
      .from(notificationSubscriptions)
      .innerJoin(users, eq(notificationSubscriptions.userId, users.id))
      .where(
        or(
          eq(notificationSubscriptions.videoId, videoId),
          eq(notificationSubscriptions.projectId, projectId),
        ),
      );
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
