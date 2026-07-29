import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { NotificationSubscriberDto } from '@klappe/shared';
import { and, asc, eq, or } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { notificationSubscriptions, users, videos } from '../db/schema';

/**
 * Die Spalte „Benachrichtigungen“ (Phase 18).
 *
 * Eingetragen wird pro Projekt oder pro Video – nie pro Fassung. Eine neue
 * Version ist derselbe Film; wer ihn verfolgt, will auch die nächste sehen.
 *
 * Gelistet wird nur das Team. Gäste stehen nicht drin: Sie bekommen Post zu
 * den Gesprächen, in denen sie stecken, und sollen nicht sehen, wer sonst
 * noch am Projekt sitzt.
 */
@Injectable()
export class SubscriptionsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async listForProject(projectId: string): Promise<NotificationSubscriberDto[]> {
    const team = await this.team();
    const eingetragen = await this.db
      .select({ userId: notificationSubscriptions.userId })
      .from(notificationSubscriptions)
      .where(eq(notificationSubscriptions.projectId, projectId));

    const gesetzt = new Set(eingetragen.map((zeile) => zeile.userId));
    return team.map((person) => ({
      user: person,
      subscribed: gesetzt.has(person.id),
      inherited: false,
    }));
  }

  async listForVideo(videoId: string): Promise<NotificationSubscriberDto[]> {
    const projectId = await this.projectOf(videoId);
    const team = await this.team();

    const eingetragen = await this.db
      .select({
        userId: notificationSubscriptions.userId,
        videoId: notificationSubscriptions.videoId,
      })
      .from(notificationSubscriptions)
      .where(
        or(
          eq(notificationSubscriptions.videoId, videoId),
          eq(notificationSubscriptions.projectId, projectId),
        ),
      );

    const amVideo = new Set(
      eingetragen.filter((zeile) => zeile.videoId !== null).map((zeile) => zeile.userId),
    );
    const ueberProjekt = new Set(
      eingetragen.filter((zeile) => zeile.videoId === null).map((zeile) => zeile.userId),
    );

    return team.map((person) => ({
      user: person,
      subscribed: amVideo.has(person.id),
      inherited: ueberProjekt.has(person.id),
    }));
  }

  async setForProject(
    projectId: string,
    userId: string,
    subscribed: boolean,
  ): Promise<NotificationSubscriberDto[]> {
    await this.requireTeamMember(userId);
    if (subscribed) {
      await this.db
        .insert(notificationSubscriptions)
        .values({ userId, projectId })
        .onConflictDoNothing();
    } else {
      await this.db
        .delete(notificationSubscriptions)
        .where(
          and(
            eq(notificationSubscriptions.userId, userId),
            eq(notificationSubscriptions.projectId, projectId),
          ),
        );
    }
    return this.listForProject(projectId);
  }

  async setForVideo(
    videoId: string,
    userId: string,
    subscribed: boolean,
  ): Promise<NotificationSubscriberDto[]> {
    await this.requireTeamMember(userId);
    await this.projectOf(videoId);

    if (subscribed) {
      await this.db
        .insert(notificationSubscriptions)
        .values({ userId, videoId })
        .onConflictDoNothing();
    } else {
      await this.db
        .delete(notificationSubscriptions)
        .where(
          and(
            eq(notificationSubscriptions.userId, userId),
            eq(notificationSubscriptions.videoId, videoId),
          ),
        );
    }
    return this.listForVideo(videoId);
  }

  /**
   * Wer eine Fassung hochlädt, verfolgt das Video ab sofort – ohne dass er
   * daran denken muss. Bewusst nur das Video: Ein Upload sagt nichts darüber
   * aus, ob ihn auch der Rest des Projekts interessiert.
   */
  async subscribeUploader(userId: string | null, videoId: string): Promise<void> {
    if (!userId) return;
    const [person] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!person || person.role === 'GUEST') return;

    await this.db
      .insert(notificationSubscriptions)
      .values({ userId, videoId })
      .onConflictDoNothing();
  }

  private async team() {
    return this.db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(and(or(eq(users.role, 'ADMIN'), eq(users.role, 'MEMBER')), eq(users.isActive, true)))
      .orderBy(asc(users.name));
  }

  private async requireTeamMember(userId: string): Promise<void> {
    const [person] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!person || person.role === 'GUEST') {
      throw new NotFoundException('Diese Person steht nicht im Team.');
    }
  }

  private async projectOf(videoId: string): Promise<string> {
    const [video] = await this.db
      .select({ projectId: videos.projectId })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1);
    if (!video) throw new NotFoundException('Video nicht gefunden.');
    return video.projectId;
  }
}
