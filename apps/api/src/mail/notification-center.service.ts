import { Inject, Injectable } from '@nestjs/common';
import type { NotificationDto, UserRole } from '@klappe/shared';
import {
  commentBodyToPlainText,
  framesToTimecode,
  versionLabel as versionNumberLabel,
} from '@klappe/shared';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { comments, notifications, projects, users, videoVersions, videos } from '../db/schema';
import { EventsService } from '../events/events.service';

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
@Injectable()
export class NotificationCenterService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: EventsService,
  ) {}

  /**
   * Legt die Einträge für einen Kommentar an. Doppelte werden still
   * übergangen – ein wiederholter Job soll nichts verdoppeln.
   */
  async record(
    commentId: string,
    videoId: string,
    recipients: { id: string; mentioned: boolean }[],
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

  /** Ohne `ids` gilt alles als gelesen. Gibt die neue ungelesene Zahl zurück. */
  async markRead(userId: string, ids?: string[]): Promise<number> {
    const wen =
      ids && ids.length > 0
        ? and(eq(notifications.userId, userId), inArray(notifications.id, ids))
        : eq(notifications.userId, userId);

    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(wen, isNull(notifications.readAt)));

    return this.unreadCount(userId);
  }
}
