import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
    /*
     * Ist nur noch eine Person eingetragen, bleibt ihr Haken zu (Phase 28).
     * Sonst entstünde ein Projekt, bei dem Kundenmaterial ins Leere läuft:
     * Der Kunde lädt hoch, und niemand erfährt davon.
     *
     * Gezählt wird gegen das **aktive** Team – wer gesperrt ist, kann keine
     * Mail mehr lesen und hält den Haken deshalb auch nicht offen.
     */
    const aktiveEingetragene = team.filter((person) => gesetzt.has(person.id));
    const letzte = aktiveEingetragene.length === 1 ? aktiveEingetragene[0].id : null;

    return team.map((person) => ({
      user: person,
      subscribed: gesetzt.has(person.id),
      inherited: false,
      locked: person.id === letzte,
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
      // Die Garantie hängt am Projekt, nicht am einzelnen Video: Kundenmaterial
      // landet im Projektordner.
      locked: false,
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
      // Der Haken ist in der Oberfläche ausgegraut – hier steht die
      // Absicherung dahinter, für die API und für ein Rennen zwischen zwei
      // Personen, die sich gleichzeitig austragen.
      await this.assertNichtLetzte(projectId, userId);
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
   * Wer ein Projekt anlegt, ist dafür eingetragen (Phase 28).
   *
   * Schließt die Lücke, die auffiel, als jemand ein Projekt anlegte, **um
   * vorab Kundenmaterial anzufordern**: Bis zum ersten eigenen Upload stand
   * niemand in der Liste, der Kunde lud hoch, und es merkte es keiner.
   */
  async subscribeProjectCreator(userId: string | null, projectId: string): Promise<void> {
    if (!userId) return;
    const [person] = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!person || person.role === 'GUEST') return;

    await this.db
      .insert(notificationSubscriptions)
      .values({ userId, projectId })
      .onConflictDoNothing();
  }

  /**
   * Die letzte eingetragene Person darf sich nicht austragen. Gezählt wird
   * gegen das aktive Team: Ein gesperrtes Konto liest keine Mail mehr und
   * hält den Platz deshalb nicht frei.
   */
  private async assertNichtLetzte(projectId: string, userId: string): Promise<void> {
    const liste = await this.listForProject(projectId);
    const eingetragen = liste.filter((eintrag) => eintrag.subscribed);
    if (eingetragen.length === 1 && eingetragen[0].user.id === userId) {
      throw new BadRequestException(
        'Mindestens eine Person muss für dieses Projekt eingetragen bleiben – sonst bekommt niemand mit, wenn der Kunde Material hochlädt.',
      );
    }
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
