import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationDto, UserRole } from '@klappe/shared';
import {
  commentBodyToPlainText,
  framesToTimecode,
  versionLabel as versionNumberLabel,
} from '@klappe/shared';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { comments, notifications, projects, users, videoVersions, videos } from '../db/schema';
import { EventsService } from '../events/events.service';
import { LocaleService } from '../i18n/locale.service';
import { PushService } from '../push/push.service';
import { renderCommentPush } from '../push/push-texte';
import { NotificationSettingsService } from '../settings/notification-settings.service';

/** So viel Kommentartext steht in der Liste; der Rest steht im Player. */
const EXCERPT_LENGTH = 160;

/**
 * Die Benachrichtigungszentrale (Phase 18).
 *
 * Was hier landet, ist dasselbe, was auch eine Mail auslöst – nur bleibt es
 * stehen. Das ist der Punkt: Wer die Mail übersehen hat, den Verteiler nicht
 * abonniert oder gerade keinen Mailserver eingerichtet hat, findet es hier
 * trotzdem. Deshalb werden die Einträge geschrieben, **bevor** der Versand
 * überhaupt geprüft wird.
 */
/** Was auf der Kachel steht – die Zentrale kennt die Namen sonst nicht. */
export interface PushKontext {
  customer: string | null;
  projectName: string;
  videoName: string;
}

/** Empfänger, so wie ihn die Auswahl in `recipients.ts` liefert. */
export interface ZentralenEmpfaenger {
  id: string;
  mentioned: boolean;
  role?: UserRole;
  locale?: string | null;
}

@Injectable()
export class NotificationCenterService {
  private readonly logger = new Logger(NotificationCenterService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: EventsService,
    private readonly push: PushService,
    private readonly notificationSettings: NotificationSettingsService,
    private readonly locales: LocaleService,
  ) {}

  /**
   * Legt die Einträge für einen Kommentar an. Doppelte werden still
   * übergangen – ein wiederholter Job soll nichts verdoppeln.
   */
  async record(
    commentId: string,
    videoId: string,
    recipients: ZentralenEmpfaenger[],
    kontext: PushKontext,
  ): Promise<void> {
    if (recipients.length === 0) return;
    await this.db
      .insert(notifications)
      .values(
        recipients.map((recipient) => ({
          userId: recipient.id,
          commentId,
          videoId,
          mentioned: recipient.mentioned,
        })),
      )
      .onConflictDoNothing();

    // Das Glöckchen springt sofort um, statt auf den Minutentakt zu warten
    // (Phase 18, Zusatz).
    for (const recipient of recipients) {
      this.events.publish({ topic: 'notification', id: recipient.id, userId: recipient.id });
    }

    await this.pushen(videoId, recipients, kontext);
  }

  /**
   * Push an die angemeldeten Geräte (Phase 29) – **nach** dem Eintrag, nie
   * statt seiner. Der Eintrag steht schon, wenn wir hier ankommen; ein
   * Fehlschlag beim Push darf deshalb nichts aufhalten und wird nur notiert.
   *
   * Ohne Ruhezeit: Die Kette gleicher Meldungen bei einem Kunden-Review
   * bündelt nicht der Server, sondern der Browser. Jede Meldung zu demselben
   * Video trägt denselben `tag`; der Browser schreibt damit die vorhandene
   * Kachel fort, statt eine zweite zu stapeln – es brummt einmal, danach
   * zählt sie still hoch. Die Zahl ist der ungelesene Stand für dieses Video,
   * sie geht also von selbst auf 0 zurück, sobald jemand hingesehen hat.
   */
  private async pushen(
    videoId: string,
    recipients: ZentralenEmpfaenger[],
    kontext: PushKontext,
  ): Promise<void> {
    for (const recipient of recipients) {
      try {
        // Push hängt am selben Admin-Schalter wie die Mail. Der Schalter sagt
        // „diese Art geht hinaus", nicht „diese Art geht per Mail hinaus" –
        // ein zweiter Satz Schalter je Weg wäre eine Verdopplung ohne Frage,
        // die er beantwortet.
        const kind = recipient.mentioned ? 'mention' : 'comment';
        const audience = recipient.role === 'GUEST' ? 'GUEST' : 'TEAM';
        if (!(await this.notificationSettings.isAllowed(kind, audience))) continue;

        const unread = await this.unreadCountForVideo(recipient.id, videoId);
        const { title, body } = renderCommentPush({
          locale: await this.locales.forUser(recipient.locale),
          mentioned: recipient.mentioned,
          unread,
          customer: kontext.customer,
          projectName: kontext.projectName,
          videoName: kontext.videoName,
        });

        await this.push.sendToUser(recipient.id, {
          title,
          body,
          tag: `video-${videoId}`,
          url: `/videos/${videoId}`,
        });
      } catch (error) {
        this.logger.warn(`Push an ${recipient.id} fehlgeschlagen: ${String(error)}`);
      }
    }
  }

  /**
   * Der ungelesene Stand für **ein** Video. Grundlage der Zahl auf der
   * Push-Kachel; deshalb dieselben Bedingungen wie in `unreadCount`, nur
   * zusätzlich auf das Video eingeschränkt.
   */
  async unreadCountForVideo(userId: string, videoId: string): Promise<number> {
    const [row] = await this.db
      .select({ anzahl: sql<number>`count(*)::int` })
      .from(notifications)
      .innerJoin(comments, eq(notifications.commentId, comments.id))
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.videoId, videoId),
          isNull(notifications.readAt),
          isNull(comments.deletedAt),
        ),
      );
    return row?.anzahl ?? 0;
  }

  async list(
    empfaenger: { id: string; role: UserRole },
    limit = 50,
  ): Promise<NotificationDto[]> {
    const userId = empfaenger.id;
    const imHaus = empfaenger.role === 'ADMIN' || empfaenger.role === 'MEMBER';
    const rows = await this.db
      .select({
        id: notifications.id,
        mentioned: notifications.mentioned,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
        body: comments.body,
        frame: comments.frame,
        parentId: comments.parentId,
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
      })
      .from(notifications)
      .innerJoin(comments, eq(notifications.commentId, comments.id))
      .innerJoin(users, eq(comments.authorId, users.id))
      .innerJoin(videoVersions, eq(comments.versionId, videoVersions.id))
      .innerJoin(videos, eq(notifications.videoId, videos.id))
      .innerJoin(projects, eq(videos.projectId, projects.id))
      // Ein gelöschter Kommentar taucht nicht mehr auf; die Zeile bleibt
      // liegen, bis der Kommentar endgültig weg ist. Und was an einer
      // inzwischen internen Fassung hängt (Phase 27), verschwindet für Gäste
      // aus dem Glöckchen – so wie die Fassung selbst.
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(comments.deletedAt),
          imHaus ? undefined : eq(videoVersions.internal, false),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));

    return rows.map((row) => {
      const nummer = versionNumberLabel(Number(row.versionNumber));
      const text = commentBodyToPlainText(row.body).replace(/\s+/g, ' ').trim();
      return {
        id: row.id,
        mentioned: row.mentioned,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
        authorName: row.authorName,
        projectName: row.projectName,
        videoId: row.videoId,
        videoName: row.videoName,
        versionLabel: row.versionLabel ? `${nummer} – ${row.versionLabel}` : nummer,
        timecode:
          row.frame !== null && row.fpsNum && row.fpsDen
            ? framesToTimecode(
                row.startTimecodeFrames + row.frame,
                { num: row.fpsNum, den: row.fpsDen },
                row.dropFrame,
              )
            : null,
        excerpt:
          text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…` : text,
        isReply: row.parentId !== null,
      };
    });
  }

  /** Nur die Zahl fürs Glöckchen – die Liste wird erst beim Öffnen geholt. */
  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ anzahl: sql<number>`count(*)::int` })
      .from(notifications)
      .innerJoin(comments, eq(notifications.commentId, comments.id))
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          isNull(comments.deletedAt),
        ),
      );
    return row?.anzahl ?? 0;
  }

  /**
   * Einen Eintrag entfernen (Phase 29).
   *
   * Gelöscht wird wirklich, nicht verborgen: Die Zeile ist nur ein Zeiger auf
   * einen Kommentar, und der bleibt unberührt, wo er steht. Wer hier
   * aufräumt, verliert eine Liste, nie einen Inhalt.
   *
   * Der Filter auf `userId` ist keine Vorsicht, sondern die Regel: Ein
   * Eintrag gehört genau einer Person. Eine fremde Kennung trifft damit
   * schlicht keine Zeile.
   */
  async remove(userId: string, id: string): Promise<number> {
    await this.db
      .delete(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.id, id)));
    return this.unreadCount(userId);
  }

  /**
   * Die gelesenen Einträge entfernen (Phase 29).
   *
   * Ungelesenes bleibt stehen – aus demselben Grund, aus dem der tägliche
   * Aufräumer es liegen lässt: Es ist das, was noch niemand angesehen hat.
   * Ein Knopf, der es mit wegnimmt, erledigt eine unerledigte Sache still.
   * Damit ist dieser Knopf nichts anderes als der Aufräumer von Hand, ohne
   * die Woche Wartezeit.
   *
   * Zurück kommt der ungelesene Stand, der dabei unverändert bleibt. Das ist
   * kein Beiwerk: Die Zahl am Glöckchen darf nicht auf 0 springen, während
   * dort noch etwas liegt.
   */
  async clearRead(userId: string): Promise<number> {
    await this.db
      .delete(notifications)
      .where(and(eq(notifications.userId, userId), isNotNull(notifications.readAt)));
    return this.unreadCount(userId);
  }

  /**
   * Ohne `ids` und ohne `videoId` gilt alles als gelesen. Gibt die neue
   * ungelesene Zahl zurück.
   *
   * `videoId` kam mit Phase 29 dazu: Wer eine Videoseite öffnet, hat die
   * Kommentarspalte vor sich – die Einträge dazu sind damit gesehen. Ohne das
   * käme die Push-Kachel für dieses Video nie auf 0 zurück und brummte
   * genau einmal, für immer.
   */
  async markRead(userId: string, ids?: string[], videoId?: string): Promise<number> {
    const wen =
      ids && ids.length > 0
        ? and(eq(notifications.userId, userId), inArray(notifications.id, ids))
        : videoId
          ? and(eq(notifications.userId, userId), eq(notifications.videoId, videoId))
          : eq(notifications.userId, userId);

    const geaendert = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(wen, isNull(notifications.readAt)))
      .returning({ id: notifications.id });

    // Das Glöckchen soll auch dann nachziehen, wenn woanders gelesen wurde –
    // etwa weil eine Videoseite geöffnet wurde. Sonst stünde die Zahl bis zum
    // nächsten Minutentakt auf dem alten Stand.
    if (geaendert.length > 0) {
      this.events.publish({ topic: 'notification', id: userId, userId });
    }

    return this.unreadCount(userId);
  }
}
