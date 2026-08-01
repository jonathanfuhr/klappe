import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type Locale,
  type NotificationKind,
  type UserRole,
  commentBodyToPlainText,
  framesToTimecode,
  versionLabel as versionNumberLabel,
  versionWebPath,
} from '@klappe/shared';
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import {
  commentMentions,
  comments,
  notificationSubscriptions,
  pendingNotifications,
  projectFiles,
  projects,
  shareLinkGrants,
  shareLinks,
  users,
  videoVersions,
  videos,
} from '../db/schema';
import { MailQueueService } from '../queue/mail-queue.service';
import { NotificationSettingsService } from '../settings/notification-settings.service';
import { SettingsService } from '../settings/settings.service';
import { decideDigest } from './digest';
import { MailService } from './mail.service';
import { NotificationCenterService } from './notification-center.service';
import {
  type NotificationCandidate,
  audienceOf,
  formatBytes,
  selectCommentRecipients,
  selectTeamRecipients,
} from './recipients';
import {
  type CommentDigestEntry,
  type MailBrand,
  type RenderedMail,
  renderBackupFailedMail,
  renderCleanupWarningMail,
  renderCommentDigestMail,
  renderCommentMail,
  renderDevicePairedMail,
  renderFirstVisitMail,
  renderProjectFileDigestMail,
  renderProjectFileMail,
  renderVersionFailedMail,
  renderVersionReadyMail,
} from './templates';

/** Zweiter Blick auf `users` – wer eine interne Fassung freigegeben hat. */
const releasers = alias(users, 'releasers');

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
    private readonly notificationSettings: NotificationSettingsService,
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

    const recipients = this.nurTeamBeiIntern(
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
    /*
     * Erwähnungen überspringen die Ruhezeit (Phase 28). „Sammelmail ja, aber
     * `@mich` sofort" – wer namentlich angesprochen wird, soll nicht erst in
     * einer Viertelstunde davon erfahren. Die übrigen Empfänger warten wie
     * bisher; deshalb wird die Liste hier geteilt und nicht die Ruhezeit
     * insgesamt übergangen.
     */
    const sofortBeiErwaehnung = minuten > 0 && (await this.notificationSettings.mentionImmediate());
    const sofort = sofortBeiErwaehnung
      ? recipients.filter((recipient) => recipient.mentioned)
      : [];
    const spaeter = recipients.filter((recipient) => !sofort.includes(recipient));

    if (minuten <= 0 || sofort.length > 0) {
      const brand = await this.mailService.brand();
      let sent = 0;
      for (const recipient of minuten <= 0 ? recipients : sofort) {
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
          const raus = await this.mailService.send(recipient.email, mail, {
            // Eine Erwähnung ist eine eigene Mailart und getrennt schaltbar:
            // Wer die Kommentarflut abstellt, will trotzdem wissen, wenn er
            // namentlich angesprochen wurde.
            kind: recipient.mentioned ? 'mention' : 'comment',
            audience: audienceOf(recipient),
          });
          if (raus) sent += 1;
        } catch (error) {
          this.logger.warn(`Benachrichtigung an ${recipient.id} fehlgeschlagen: ${String(error)}`);
        }
      }
      if (minuten <= 0) return sent;
    }

    if (spaeter.length === 0) return 0;

    // Vormerken statt verschicken. Der Eintrag hält nur fest, *dass* jemand
    // etwas verpasst hat – Text, Timecode und Fassung werden erst beim
    // Versand gelesen, damit eine nachträgliche Änderung noch ankommt.
    await this.db
      .insert(pendingNotifications)
      .values(
        spaeter.map((recipient) => ({
          userId: recipient.id,
          commentId,
          videoId: row.videoId,
          mentioned: recipient.mentioned,
        })),
      )
      .onConflictDoNothing();

    for (const recipient of spaeter) {
      await this.mailQueue.enqueue(
        { kind: 'digest', userId: recipient.id, videoId: row.videoId },
        minuten * 60_000,
      );
    }

    this.logger.log(
      `${spaeter.length} Benachrichtigung(en) zu Kommentar ${commentId} vorgemerkt, Versand in ${minuten} Min.`,
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
    const kreis = empfaenger ? audienceOf(empfaenger) : 'GUEST';
    const imHaus = kreis === 'TEAM';
    /*
     * Und was der Admin abgeschaltet hat, fällt ebenfalls heraus (Phase 28) –
     * je Eintrag, nicht je Mail: Wer „Kommentare aus, Erwähnungen an" gesetzt
     * hat, bekommt eine Sammelmail, in der nur noch die Erwähnungen stehen.
     */
    const [kommentareErlaubt, erwaehnungenErlaubt] = await Promise.all([
      this.notificationSettings.isAllowed('comment', kreis),
      this.notificationSettings.isAllowed('mention', kreis),
    ]);
    const sichtbar = wartend.filter(
      (eintrag) =>
        eintrag.comment.deletedAt === null &&
        (imHaus || !eintrag.internal) &&
        (eintrag.mentioned ? erwaehnungenErlaubt : kommentareErlaubt),
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
      await this.mailService.send(empfaenger.email, mail, {
        // Nach dem Filtern oben steht fest, dass diese Art erlaubt ist:
        // Ist eine Erwähnung übrig, dann weil Erwähnungen erlaubt sind.
        kind: sichtbar.some((eintrag) => eintrag.mentioned) ? 'mention' : 'comment',
        audience: kreis,
      });
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

  /**
   * „Für X steht v3 bereit." (Phase 28)
   *
   * **Zwei Zeitpunkte, eine Vorlage.** Das Team erfährt es, sobald die Fassung
   * fertig verarbeitet ist – auch bei einer internen, denn die interne Runde
   * ist ja genau der Anlass, warum jemand hinschauen soll. Gäste erfahren es
   * erst mit der Freigabe; deshalb steht der Kreis im Auftrag und wird nicht
   * hier hergeleitet.
   *
   * Ausgelöst wird nach dem **Verarbeiten**, nicht nach dem Hochladen: Eine
   * Mail zu einer Fassung, die noch vierzig Minuten rechnet, führt den Kunden
   * auf eine Seite ohne Bild.
   */
  async notifyVersionReady(versionId: string, audience: 'TEAM' | 'GUEST'): Promise<number> {
    if (!(await this.mailService.isReady())) return 0;

    const row = await this.loadVersion(versionId);
    if (!row) return 0;
    // In der Zwischenzeit intern gestellt? Dann geht an die Kundenseite nichts.
    if (audience === 'GUEST' && row.internal) return 0;

    const empfaenger =
      audience === 'TEAM'
        ? await this.loadSubscribers(row.videoId, row.projectId)
        : await this.loadProjectGuests(row.projectId, row.videoId);

    const auswahl = empfaenger.filter(
      (kandidat) =>
        kandidat.isActive &&
        kandidat.notificationsEnabled &&
        audienceOf(kandidat) === audience &&
        // Wer die Fassung selbst hochgeladen hat, weiß Bescheid.
        kandidat.id !== row.uploadedById,
    );
    if (auswahl.length === 0) return 0;

    const brand = await this.mailService.brand();
    const url = `${this.config.publicUrl}${row.webUrl}`;
    let sent = 0;

    for (const recipient of auswahl) {
      const mail = renderVersionReadyMail({
        brand,
        locale: await this.mailService.localeFor(recipient.locale),
        recipientName: recipient.name,
        projectName: row.projectName,
        videoName: row.videoName,
        versionLabel: versionLabelOf(row),
        internal: audience === 'TEAM' && row.internal,
        releasedBy: audience === 'GUEST' ? row.releasedByName : null,
        url,
        unsubscribeUrl: this.mailService.unsubscribeUrl(recipient.id),
      });
      try {
        if (await this.mailService.send(recipient.email, mail, { kind: 'version-ready', audience })) {
          sent += 1;
        }
      } catch (error) {
        this.logger.warn(`Fassungs-Hinweis an ${recipient.id} fehlgeschlagen: ${String(error)}`);
      }
    }
    return sent;
  }

  /**
   * „v3 konnte nicht verarbeitet werden." – nur ans Team.
   *
   * Ein `FAILED` bemerkte bis Phase 28 nur, wer zufällig hinsah: Nach einem
   * Upload über Nacht stand am Morgen nichts da, und keiner wusste warum.
   */
  async notifyVersionFailed(versionId: string): Promise<number> {
    if (!(await this.mailService.isReady())) return 0;

    const row = await this.loadVersion(versionId);
    if (!row) return 0;

    const empfaenger = (await this.loadSubscribers(row.videoId, row.projectId)).filter(
      (kandidat) =>
        kandidat.isActive && kandidat.notificationsEnabled && audienceOf(kandidat) === 'TEAM',
    );
    // Anders als beim Fertigmelden bekommt der Hochladende die Nachricht
    // **auch** – es ist seine Datei, die nicht durchgelaufen ist.
    if (empfaenger.length === 0) return 0;

    const brand = await this.mailService.brand();
    const url = `${this.config.publicUrl}${row.webUrl}`;
    let sent = 0;

    for (const recipient of empfaenger) {
      const mail = renderVersionFailedMail({
        brand,
        locale: await this.mailService.localeFor(recipient.locale),
        recipientName: recipient.name,
        projectName: row.projectName,
        videoName: row.videoName,
        versionLabel: versionLabelOf(row),
        reason: row.processingError,
        url,
        unsubscribeUrl: this.mailService.unsubscribeUrl(recipient.id),
      });
      try {
        if (
          await this.mailService.send(recipient.email, mail, {
            kind: 'version-failed',
            audience: 'TEAM',
          })
        ) {
          sent += 1;
        }
      } catch (error) {
        this.logger.warn(`Fehlschlag-Hinweis an ${recipient.id} fehlgeschlagen: ${String(error)}`);
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

    const recipients = selectTeamRecipients(
      await this.projektEmpfaenger(row.file.projectId),
      row.file.uploadedById,
    );
    if (recipients.length === 0) return 0;
    await this.markiereBerichtet([projectFileId]);

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
        // Kundenmaterial geht ausschließlich ans Team – der Kunde weiß ja,
        // was er hochgeladen hat.
        if (await this.mailService.send(recipient.email, mail, {
          kind: 'project-file',
          audience: 'TEAM',
        })) {
          sent += 1;
        }
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
  private nurTeamBeiIntern<T extends { role: UserRole }>(intern: boolean, empfaenger: T[]): T[] {
    if (!intern) return empfaenger;
    return empfaenger.filter((eintrag) => audienceOf(eintrag) === 'TEAM');
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

  /** „Der Kunde hat zum ersten Mal reingeschaut." – ans Team (Phase 28). */
  async notifyFirstVisit(userId: string, shareLinkId: string): Promise<number> {
    if (!(await this.mailService.isReady())) return 0;

    const [ziel] = await this.db
      .select({
        gastName: users.name,
        projectId: shareLinks.projectId,
        videoProjectId: videos.projectId,
        videoName: videos.name,
        projectName: projects.name,
      })
      .from(shareLinks)
      .innerJoin(users, eq(users.id, userId))
      .leftJoin(videos, eq(shareLinks.videoId, videos.id))
      .leftJoin(projects, eq(shareLinks.projectId, projects.id))
      .where(eq(shareLinks.id, shareLinkId))
      .limit(1);

    const projectId = ziel?.projectId ?? ziel?.videoProjectId;
    if (!ziel || !projectId) return 0;

    // Bei einer Videofreigabe steht der Projektname nicht am Link; dann nennt
    // die Mail das Video – das ist ohnehin das, was der Gast gesehen hat.
    const zielName = ziel.projectName ?? ziel.videoName ?? 'Klappe';
    return this.kurzeMailAnTeam({
      projectId,
      kind: 'guest-first-visit',
      url: `${this.config.publicUrl}/projekte/${projectId}`,
      bauen: (recipient, brand, locale) =>
        renderFirstVisitMail({
          brand,
          locale,
          recipientName: recipient.name,
          guestName: ziel.gastName,
          targetName: zielName,
          url: `${this.config.publicUrl}/projekte/${projectId}`,
          unsubscribeUrl: this.mailService.unsubscribeUrl(recipient.id),
        }),
    });
  }

  /** Letzte Warnung vor dem Aufräumen archivierter Projekte (Phase 28). */
  async notifyCleanupWarning(
    projectId: string,
    days: number,
    versionCount: number,
  ): Promise<number> {
    if (!(await this.mailService.isReady())) return 0;

    const [projekt] = await this.db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!projekt) return 0;

    const url = `${this.config.publicUrl}/projekte/${projectId}`;
    return this.kurzeMailAnTeam({
      projectId,
      kind: 'cleanup-warning',
      url,
      bauen: (recipient, brand, locale) =>
        renderCleanupWarningMail({
          brand,
          locale,
          recipientName: recipient.name,
          projectName: projekt.name,
          days,
          versionCount,
          url,
          unsubscribeUrl: this.mailService.unsubscribeUrl(recipient.id),
        }),
    });
  }

  /**
   * „Die Sicherung ist fehlgeschlagen." – an die Administratoren.
   *
   * Nicht an die Eingetragenen eines Projekts, sondern an alle Admins: Eine
   * Sicherung gehört keinem Projekt, und wer sie einrichtet, ist Admin.
   */
  async notifyBackupFailed(reason: string | null): Promise<number> {
    if (!(await this.mailService.isReady())) return 0;

    const admins = await this.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        notificationsEnabled: users.notificationsEnabled,
        locale: users.locale,
        role: users.role,
      })
      .from(users)
      .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true)));

    const url = `${this.config.publicUrl}/einstellungen`;
    return this.verschicke({
      empfaenger: admins.filter((kandidat) => kandidat.notificationsEnabled),
      kind: 'backup-failed',
      audience: 'TEAM',
      bauen: (recipient, brand, locale) =>
        renderBackupFailedMail({
          brand,
          locale,
          recipientName: recipient.name,
          reason,
          url,
          unsubscribeUrl: this.mailService.unsubscribeUrl(recipient.id),
        }),
    });
  }

  /** „Ein neues Gerät nutzt dein Konto." – an den Kontoinhaber (Phase 28). */
  async notifyDevicePaired(userId: string, clientName: string): Promise<number> {
    if (!(await this.mailService.isReady())) return 0;

    const empfaenger = await this.loadRecipient(userId);
    if (!empfaenger) return 0;

    const url = `${this.config.publicUrl}/konto`;
    return this.verschicke({
      empfaenger: [empfaenger],
      kind: 'device-paired',
      audience: audienceOf(empfaenger),
      bauen: (recipient, brand, locale) =>
        renderDevicePairedMail({
          brand,
          locale,
          recipientName: recipient.name,
          clientName,
          url,
          unsubscribeUrl: this.mailService.unsubscribeUrl(recipient.id),
        }),
    });
  }

  /** Eine kurze Mail an alle, die für dieses Projekt eingetragen sind. */
  private async kurzeMailAnTeam(input: {
    projectId: string;
    kind: NotificationKind;
    url: string;
    bauen: (
      recipient: NotificationCandidate,
      brand: MailBrand,
      locale: Locale,
    ) => RenderedMail;
  }): Promise<number> {
    const empfaenger = (await this.projektEmpfaenger(input.projectId)).filter(
      (kandidat) =>
        kandidat.isActive && kandidat.notificationsEnabled && audienceOf(kandidat) === 'TEAM',
    );
    return this.verschicke({
      empfaenger,
      kind: input.kind,
      audience: 'TEAM',
      bauen: input.bauen,
    });
  }

  /** Der gemeinsame Versandlauf: bauen, schicken, Fehler einzeln abfangen. */
  private async verschicke(input: {
    empfaenger: NotificationCandidate[];
    kind: NotificationKind;
    audience: 'TEAM' | 'GUEST';
    bauen: (
      recipient: NotificationCandidate,
      brand: MailBrand,
      locale: Locale,
    ) => RenderedMail;
  }): Promise<number> {
    if (input.empfaenger.length === 0) return 0;
    const brand = await this.mailService.brand();
    let sent = 0;

    for (const recipient of input.empfaenger) {
      const locale = await this.mailService.localeFor(recipient.locale);
      try {
        if (
          await this.mailService.send(recipient.email, input.bauen(recipient, brand, locale), {
            kind: input.kind,
            audience: input.audience,
          })
        ) {
          sent += 1;
        }
      } catch (error) {
        this.logger.warn(
          `Hinweis (${input.kind}) an ${recipient.id} fehlgeschlagen: ${String(error)}`,
        );
      }
    }
    return sent;
  }

  /**
   * Sammelmail über das Kundenmaterial eines Projekts (Phase 28).
   *
   * Ein Kunde lädt selten eine Datei – er lädt einen Ordner. Nach demselben
   * Muster wie bei den Kommentaren: Erst wenn eine Weile Ruhe war, geht
   * **eine** Mail über alles hinaus, was seither aufgelaufen ist. Die Ruhezeit
   * ist eine eigene und deutlich höher, weil ein Kameraband länger lädt, als
   * ein Kommentar zu tippen dauert.
   */
  async flushProjectFileDigest(projectId: string): Promise<number> {
    if (!(await this.mailService.isReady())) return 0;

    const offen = await this.db
      .select({
        id: projectFiles.id,
        filename: projectFiles.filename,
        sizeBytes: projectFiles.sizeBytes,
        createdAt: projectFiles.createdAt,
        uploadedById: projectFiles.uploadedById,
        uploaderName: users.name,
      })
      .from(projectFiles)
      .leftJoin(users, eq(projectFiles.uploadedById, users.id))
      .where(and(eq(projectFiles.projectId, projectId), isNull(projectFiles.notifiedAt)))
      .orderBy(asc(projectFiles.createdAt));
    if (offen.length === 0) return 0;

    const minuten = await this.notificationSettings.projectFileDigestMinutes();
    const entscheidung = decideDigest({
      newestAt: offen.reduce((max, datei) => Math.max(max, datei.createdAt.getTime()), 0),
      now: Date.now(),
      minutes: minuten,
    });
    if (!entscheidung.send) {
      await this.mailQueue.enqueue({ kind: 'project-file-digest', projectId }, entscheidung.retryInMs);
      return 0;
    }

    const [projekt] = await this.db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!projekt) return 0;

    // Laden mehrere Gäste hoch, nennt die Mail den ersten – die Liste der
    // Dateien darunter beantwortet den Rest.
    const hochlader = offen.find((datei) => datei.uploaderName)?.uploaderName ?? 'Ein Gast';
    const hochladerIds = new Set(offen.map((datei) => datei.uploadedById).filter(Boolean));
    const recipients = (await this.projektEmpfaenger(projectId)).filter(
      (kandidat) =>
        kandidat.isActive && kandidat.notificationsEnabled && !hochladerIds.has(kandidat.id),
    );

    // Die Dateien gelten auch dann als berichtet, wenn niemand eingetragen
    // ist – sonst liefe die Warteschlange endlos gegen dieselbe Liste.
    await this.markiereBerichtet(offen.map((datei) => datei.id));
    if (recipients.length === 0) return 0;

    const gesamt = offen.reduce((summe, datei) => summe + datei.sizeBytes, 0);
    const brand = await this.mailService.brand();
    const url = `${this.config.publicUrl}/projekte/${projectId}`;
    let sent = 0;

    for (const recipient of recipients) {
      const locale = await this.mailService.localeFor(recipient.locale);
      // Bei genau einer Datei bleibt es bei der gewohnten Einzelmail – eine
      // „Sammlung" von einem Stück liest sich albern.
      const mail =
        offen.length === 1
          ? renderProjectFileMail({
              brand,
              locale,
              recipientName: recipient.name,
              uploaderName: hochlader,
              projectName: projekt.name,
              filename: offen[0].filename,
              sizeLabel: formatBytes(offen[0].sizeBytes),
              url,
              unsubscribeUrl: this.mailService.unsubscribeUrl(recipient.id),
            })
          : renderProjectFileDigestMail({
              brand,
              locale,
              recipientName: recipient.name,
              uploaderName: hochlader,
              projectName: projekt.name,
              files: offen.map((datei) => ({
                filename: datei.filename,
                sizeLabel: formatBytes(datei.sizeBytes),
              })),
              totalSizeLabel: formatBytes(gesamt),
              url,
              unsubscribeUrl: this.mailService.unsubscribeUrl(recipient.id),
            });

      try {
        if (
          await this.mailService.send(recipient.email, mail, {
            kind: 'project-file',
            audience: 'TEAM',
          })
        ) {
          sent += 1;
        }
      } catch (error) {
        this.logger.warn(`Upload-Sammelmail an ${recipient.id} fehlgeschlagen: ${String(error)}`);
      }
    }
    return sent;
  }

  /**
   * Wer für dieses Projekt eingetragen ist (Phase 28).
   *
   * Bis dahin ging Kundenmaterial an **jedes** Team-Mitglied. Das war bequem,
   * solange das Team klein war, und wurde mit jedem Projekt lauter. Jetzt
   * zählt die Eintragung – und dass mindestens eine Person eingetragen
   * *bleibt*, sichert `SubscriptionsService` ab.
   */
  private async projektEmpfaenger(projectId: string): Promise<NotificationCandidate[]> {
    return this.db
      .selectDistinctOn([users.id], {
        id: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        notificationsEnabled: users.notificationsEnabled,
        locale: users.locale,
        role: users.role,
      })
      .from(notificationSubscriptions)
      .innerJoin(users, eq(notificationSubscriptions.userId, users.id))
      .where(eq(notificationSubscriptions.projectId, projectId));
  }

  private async markiereBerichtet(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(projectFiles)
      .set({ notifiedAt: new Date() })
      .where(inArray(projectFiles.id, ids));
  }

  /** Alles, was eine Fassungs-Mail über ihre Fassung wissen muss (Phase 28). */
  private async loadVersion(versionId: string) {
    const [row] = await this.db
      .select({
        versionNumber: videoVersions.versionNumber,
        versionLabel: videoVersions.label,
        internal: videoVersions.internal,
        processingError: videoVersions.processingError,
        uploadedById: videoVersions.uploadedById,
        releasedByName: releasers.name,
        videoId: videos.id,
        videoName: videos.name,
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(videoVersions)
      .innerJoin(videos, eq(videoVersions.videoId, videos.id))
      .innerJoin(projects, eq(videos.projectId, projects.id))
      .leftJoin(releasers, eq(videoVersions.releasedById, releasers.id))
      .where(eq(videoVersions.id, versionId))
      .limit(1);
    if (!row) return null;
    // Der Knopf in der Mail führt direkt auf die Fassung, nicht nur aufs
    // Video (Phase 27/28) – denselben Pfad legt die API als `webUrl` an.
    return { ...row, webUrl: versionWebPath(row.videoId, Number(row.versionNumber)) };
  }

  /**
   * Gäste, die dieses Video sehen dürfen – über eine Projekt- oder eine
   * Videofreigabe, zurückgezogene und abgelaufene ausgenommen.
   *
   * Bewusst die **wirksamen Zugänge** und nicht „alle Gäste des Projekts":
   * Eine Videofreigabe auf ein anderes Video geht diese Fassung nichts an.
   */
  private async loadProjectGuests(
    projectId: string,
    videoId: string,
  ): Promise<NotificationCandidate[]> {
    const now = new Date();
    return this.db
      .selectDistinctOn([users.id], {
        id: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        notificationsEnabled: users.notificationsEnabled,
        locale: users.locale,
        role: users.role,
      })
      .from(shareLinkGrants)
      .innerJoin(shareLinks, eq(shareLinkGrants.shareLinkId, shareLinks.id))
      .innerJoin(users, eq(shareLinkGrants.userId, users.id))
      .where(
        and(
          isNull(shareLinkGrants.revokedAt),
          isNull(shareLinks.revokedAt),
          or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, now)),
          // Einbett-Links haben keinen Empfänger, den man anschreiben könnte.
          eq(shareLinks.isEmbed, false),
          or(
            and(eq(shareLinks.scope, 'PROJECT'), eq(shareLinks.projectId, projectId)),
            and(eq(shareLinks.scope, 'VIDEO'), eq(shareLinks.videoId, videoId)),
          ),
        ),
      );
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
        locale: users.locale,
        // Für die Frage, ob interne Fassungen mit in die Sammelmail dürfen –
        // und welcher der beiden Schalter einer Mailart greift (Phase 28).
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
        role: users.role,
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
        role: users.role,
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
        role: users.role,
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
