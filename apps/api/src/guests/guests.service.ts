/**
 * Wer kommt hier eigentlich herein?
 *
 * Freigabe-Links sind schnell erstellt und ebenso schnell vergessen. Diese
 * Übersicht dreht die Sicht um: nicht „welche Links gibt es", sondern „welche
 * Personen haben Zugriff und worüber". Nur so lässt sich der Zugang gezielt
 * entziehen, ohne einen Link zu killen, den andere noch brauchen.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { GuestAccessDto, GuestCandidateDto, GuestOverviewDto } from '@klappe/shared';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { projects, shareLinkGrants, shareLinks, users, videos } from '../db/schema';
import { MailService } from '../mail/mail.service';
import { renderAccessGrantedMail } from '../mail/templates';
import { createShareToken } from '../shares/share-token';
import { isLinkActive } from '../shares/shares.service';
import { type GuestGrantRow, summarizeGuests } from './guest-summary';

@Injectable()
export class GuestsService {
  private readonly logger = new Logger(GuestsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly mailService: MailService,
  ) {}

  /** Alle Gäste, die dieses Projekt erreichen – auch über Videofreigaben darin. */
  async listForProject(projectId: string): Promise<GuestAccessDto[]> {
    const [project] = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException('Projekt nicht gefunden.');

    return summarizeGuests(await this.loadGrants(await this.linkIdsForProject(projectId)));
  }

  /**
   * Gäste, die dieses Video sehen können. Dazu gehören die Videofreigaben und
   * die Projektfreigabe – letztere ist der häufigere Weg und darf hier nicht
   * fehlen, sonst wirkt die Liste leer, obwohl der Kunde längst zuschaut.
   */
  async listForVideo(videoId: string): Promise<GuestAccessDto[]> {
    const [video] = await this.db
      .select({ id: videos.id, projectId: videos.projectId })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1);
    if (!video) throw new NotFoundException('Video nicht gefunden.');

    const rows = await this.db
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .where(or(eq(shareLinks.videoId, videoId), eq(shareLinks.projectId, video.projectId)));

    return summarizeGuests(await this.loadGrants(rows.map((row) => row.id)));
  }

  /** Workspace-weite Liste: jedes Gastkonto mit den Projekten, die es erreicht. */
  async listAll(): Promise<GuestOverviewDto[]> {
    const rows = await this.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        isActive: users.isActive,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        shareLinkId: shareLinks.id,
        revokedAt: shareLinkGrants.revokedAt,
        linkRevokedAt: shareLinks.revokedAt,
        expiresAt: shareLinks.expiresAt,
        projectId: sql<string | null>`coalesce(${shareLinks.projectId}, ${videos.projectId})`,
        projectName: projects.name,
      })
      .from(users)
      .leftJoin(shareLinkGrants, eq(shareLinkGrants.userId, users.id))
      .leftJoin(shareLinks, eq(shareLinks.id, shareLinkGrants.shareLinkId))
      .leftJoin(videos, eq(videos.id, shareLinks.videoId))
      .leftJoin(
        projects,
        eq(projects.id, sql`coalesce(${shareLinks.projectId}, ${videos.projectId})`),
      )
      .where(eq(users.role, 'GUEST'));

    const byUser = new Map<string, GuestOverviewDto>();
    const projectsSeen = new Map<string, Map<string, { name: string; linkCount: number }>>();

    for (const row of rows) {
      let entry = byUser.get(row.userId);
      if (!entry) {
        entry = {
          user: { id: row.userId, name: row.name, email: row.email, role: 'GUEST' },
          isActive: row.isActive,
          projects: [],
          linkCount: 0,
          activeLinkCount: 0,
          createdAt: row.createdAt.toISOString(),
          lastSeenAt: row.lastLoginAt?.toISOString() ?? null,
        };
        byUser.set(row.userId, entry);
        projectsSeen.set(row.userId, new Map());
      }

      if (!row.shareLinkId) continue;
      entry.linkCount += 1;

      const offen =
        row.revokedAt === null &&
        isLinkActive({ revokedAt: row.linkRevokedAt, expiresAt: row.expiresAt });
      if (offen) entry.activeLinkCount += 1;

      if (row.projectId && row.projectName) {
        const map = projectsSeen.get(row.userId) as Map<string, { name: string; linkCount: number }>;
        const known = map.get(row.projectId);
        if (known) known.linkCount += 1;
        else map.set(row.projectId, { name: row.projectName, linkCount: 1 });
      }
    }

    for (const [userId, entry] of byUser) {
      entry.projects = [...(projectsSeen.get(userId) ?? new Map())]
        .map(([id, value]) => ({ id, name: value.name, linkCount: value.linkCount }))
        .sort((left, right) => left.name.localeCompare(right.name, 'de'));
    }

    return [...byUser.values()].sort((left, right) =>
      (right.lastSeenAt ?? '').localeCompare(left.lastSeenAt ?? ''),
    );
  }

  /**
   * Zugriff auf ein ganzes Projekt entziehen oder zurückgeben.
   *
   * Der Entzug gilt für **diesen einen Gast** an allen Links, die ins Projekt
   * führen. Der Link selbst bleibt bestehen, andere Kunden merken nichts.
   */
  async setProjectAccessRevoked(
    projectId: string,
    userId: string,
    revoked: boolean,
  ): Promise<GuestAccessDto[]> {
    const linkIds = await this.linkIdsForProject(projectId);
    if (linkIds.length === 0) {
      throw new NotFoundException('Für dieses Projekt gibt es keine Freigaben.');
    }

    const rows = await this.db
      .update(shareLinkGrants)
      .set({ revokedAt: revoked ? new Date() : null })
      .where(
        and(
          eq(shareLinkGrants.userId, userId),
          inArray(shareLinkGrants.shareLinkId, linkIds),
        ),
      )
      .returning();

    if (rows.length === 0) {
      throw new NotFoundException('Dieser Gast hat in diesem Projekt keinen Zugang.');
    }

    this.logger.log(
      `${revoked ? 'Entzogen' : 'Zurückgegeben'}: Gast ${userId} in Projekt ${projectId} (${rows.length} Freigaben)`,
    );
    return this.listForProject(projectId);
  }

  /**
   * Einen Gast, der bisher nur einzelne Videos sieht, auf weitere Videos oder
   * aufs ganze Projekt erweitern (Phase 18).
   *
   * Der Umweg über einen neuen Link und eine neue Mail entfällt: Der Gast hat
   * längst ein Konto und kommt schon herein, es fehlt ihm nur die Erlaubnis
   * für das nächste Video. Technisch entsteht dabei eine **Direktfreigabe** –
   * ein Freigabe-Link, den niemand verschickt und den die Oberfläche deshalb
   * ohne Adresse zeigt. Damit bleibt alles Weitere, wie man es kennt: Der
   * Zugang lässt sich einzeln entziehen, die Rechte einzeln setzen, und in der
   * Übersicht steht, worüber jemand hereinkommt.
   *
   * Die Rechte werden von dem übernommen, was der Gast in diesem Projekt schon
   * hat – wer bisher kommentieren durfte, darf es auch am nächsten Video.
   */
  async extendAccess(
    projectId: string,
    userId: string,
    ziel: { scope: 'PROJECT' } | { scope: 'VIDEO'; videoIds: string[] },
    actorId: string,
    optionen?: {
      /** Ohne Angabe: übernehmen, was der Gast im Projekt schon darf. */
      allowComments?: boolean;
      allowDownload?: boolean;
      allowUpload?: boolean;
      /** Dem Gast per Mail Bescheid geben (Phase 20). Ohne Angabe: ja. */
      benachrichtigen?: boolean;
    },
  ): Promise<GuestAccessDto[]> {
    const bisher = (await this.listForProject(projectId)).find(
      (eintrag) => eintrag.user.id === userId,
    );

    // Zwei Wege führen hierher: ein Gast, der im Projekt schon drin ist und
    // erweitert wird – oder einer aus einem Projekt desselben Kunden, den man
    // hinzunimmt. Alles andere wäre eine Hintertür an den Links vorbei.
    if (!bisher) {
      const moeglich = await this.listCandidates(projectId);
      if (!moeglich.some((eintrag) => eintrag.user.id === userId)) {
        throw new NotFoundException(
          'Dieser Gast gehört weder zu diesem Projekt noch zu einem Projekt desselben Kunden.',
        );
      }
    }

    const rechte = {
      // Ein hinzugenommener Gast darf erst einmal nur schauen und
      // kommentieren; alles Weitere ist eine eigene Entscheidung.
      allowComments: optionen?.allowComments ?? bisher?.canComment ?? true,
      allowDownload: optionen?.allowDownload ?? bisher?.canDownload ?? false,
      // Hochladen hängt am Projekt; bei einer Erweiterung auf Videos bleibt es aus.
      allowUpload:
        ziel.scope === 'PROJECT' ? (optionen?.allowUpload ?? bisher?.canUpload ?? false) : false,
    };

    const ziele: { scope: 'PROJECT' | 'VIDEO'; id: string }[] =
      ziel.scope === 'PROJECT'
        ? [{ scope: 'PROJECT', id: projectId }]
        : await this.pruefeVideos(projectId, ziel.videoIds);

    for (const eintrag of ziele) {
      const linkId = await this.direktfreigabe(eintrag, actorId);
      await this.db
        .insert(shareLinkGrants)
        .values({ shareLinkId: linkId, userId, ...rechte })
        .onConflictDoUpdate({
          target: [shareLinkGrants.shareLinkId, shareLinkGrants.userId],
          // Ein früher entzogener Zugang wird damit ausdrücklich wieder geöffnet.
          set: { revokedAt: null, ...rechte },
        });
    }

    this.logger.log(
      `Gast ${userId} erweitert auf ${ziel.scope === 'PROJECT' ? `Projekt ${projectId}` : `${ziele.length} Video(s)`}.`,
    );

    if (optionen?.benachrichtigen !== false) {
      await this.meldeZugang(userId, projectId, ziele, actorId);
    }
    return this.listForProject(projectId);
  }

  /**
   * Dem Gast sagen, dass etwas Neues für ihn offensteht (Phase 20).
   *
   * Bis dahin geschah das lautlos: Ein Klick in der Gästeliste öffnete einen
   * Zugang, von dem der Gast nichts erfuhr – er hätte von selbst nachsehen
   * müssen. Die Mail trägt keinen Code und keinen neuen Link; der Gast hat
   * seinen Zugang ja schon und meldet sich an wie immer.
   *
   * Scheitert der Versand, bleibt die Freigabe trotzdem bestehen. Sie ist die
   * Hauptsache, die Mail nur der Hinweis darauf – ein stummer Mailserver darf
   * nicht dazu führen, dass der Klick als Ganzes fehlschlägt.
   */
  private async meldeZugang(
    userId: string,
    projectId: string,
    ziele: { scope: 'PROJECT' | 'VIDEO'; id: string }[],
    actorId: string,
  ): Promise<void> {
    try {
      if (!(await this.mailService.isReady())) return;

      const [gast] = await this.db
        .select({
          name: users.name,
          email: users.email,
          isActive: users.isActive,
          notificationsEnabled: users.notificationsEnabled,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      // Wer abbestellt hat oder gesperrt ist, bekommt nichts. Der Zugang
      // steht trotzdem – er ist von der Mail unabhängig.
      if (!gast || !gast.isActive || !gast.notificationsEnabled) return;

      const [projekt] = await this.db
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      if (!projekt) return;

      const [actor] = await this.db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, actorId))
        .limit(1);

      const videoZiele = ziele.filter((eintrag) => eintrag.scope === 'VIDEO');
      let targetName = projekt.name;
      let url = `${this.config.publicUrl}/projekte/${projectId}`;

      if (videoZiele.length === 1) {
        const [video] = await this.db
          .select({ name: videos.name })
          .from(videos)
          .where(eq(videos.id, videoZiele[0].id))
          .limit(1);
        // Ein einzelnes Video beim Namen nennen und direkt dorthin führen –
        // „Projekt X" wäre irreführend, er sieht ja nur dieses eine.
        if (video) {
          targetName = `${video.name} (${projekt.name})`;
          url = `${this.config.publicUrl}/videos/${videoZiele[0].id}`;
        }
      } else if (videoZiele.length > 1) {
        targetName = `${videoZiele.length} Videos in ${projekt.name}`;
      }

      await this.mailService.send(
        gast.email,
        renderAccessGrantedMail({
          brand: await this.mailService.brand(),
          recipientName: gast.name,
          targetName,
          actorName: actor?.name ?? 'Jemand aus dem Team',
          url,
          unsubscribeUrl: this.mailService.unsubscribeUrl(userId),
        }),
      );
    } catch (error) {
      this.logger.warn(`Hinweis auf den neuen Zugang ging nicht raus (${userId}): ${String(error)}`);
    }
  }

  /** Die Videos müssen zu diesem Projekt gehören – sonst wäre es ein Ausbruch. */
  private async pruefeVideos(
    projectId: string,
    videoIds: string[],
  ): Promise<{ scope: 'VIDEO'; id: string }[]> {
    const eindeutig = [...new Set(videoIds)];
    if (eindeutig.length === 0) {
      throw new BadRequestException('Es wurde kein Video ausgewählt.');
    }

    const rows = await this.db
      .select({ id: videos.id })
      .from(videos)
      .where(and(inArray(videos.id, eindeutig), eq(videos.projectId, projectId)));

    if (rows.length !== eindeutig.length) {
      throw new BadRequestException('Mindestens ein Video gehört nicht zu diesem Projekt.');
    }
    return rows.map((row) => ({ scope: 'VIDEO' as const, id: row.id }));
  }

  /**
   * Sucht die Direktfreigabe für ein Ziel oder legt sie an. Eine je Ziel
   * genügt: Was die einzelnen Gäste dürfen, steht an ihrem Eintrag, nicht am
   * Link.
   */
  private async direktfreigabe(
    ziel: { scope: 'PROJECT' | 'VIDEO'; id: string },
    actorId: string,
  ): Promise<string> {
    const [vorhanden] = await this.db
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .where(
        and(
          eq(shareLinks.isDirect, true),
          isNull(shareLinks.revokedAt),
          ziel.scope === 'PROJECT'
            ? eq(shareLinks.projectId, ziel.id)
            : eq(shareLinks.videoId, ziel.id),
          eq(shareLinks.scope, ziel.scope),
        ),
      )
      .limit(1);
    if (vorhanden) return vorhanden.id;

    const [neu] = await this.db
      .insert(shareLinks)
      .values({
        token: createShareToken(),
        scope: ziel.scope,
        projectId: ziel.scope === 'PROJECT' ? ziel.id : null,
        videoId: ziel.scope === 'VIDEO' ? ziel.id : null,
        label: 'Direktfreigabe',
        isDirect: true,
        // Am Link steht das Nötigste; was jemand darf, hängt an seinem Eintrag.
        allowComments: false,
        allowDownload: false,
        allowUpload: false,
        createdById: actorId,
      })
      .returning({ id: shareLinks.id });
    return neu.id;
  }

  /**
   * Wen könnte man diesem Projekt noch hinzufügen? (Phase 18)
   *
   * Die Antwort: alle Gäste aus Projekten desselben Kunden. Das ist der
   * Zusammenhang, in dem die Frage aufkommt – „der kennt das Projekt doch
   * schon, warum muss ich ihm einen neuen Link schicken?“. Weiter zu gehen und
   * *alle* Gäste des Workspace anzubieten wäre gefährlich: Zwei Kunden dürfen
   * nicht versehentlich ineinander rutschen.
   *
   * Ohne Kunden am Projekt gibt es keinen Kreis, aus dem man wählen könnte –
   * dann bleibt die Liste leer. Die Oberfläche sagt, woran es liegt.
   *
   * Mit `videoId` gilt dieselbe Frage für ein einzelnes Video (Phase 20).
   * Zwei Unterschiede: Nicht zur Wahl steht, wer dieses Video schon sieht –
   * nicht, wer irgendwo im Projekt ist. Und Gäste, die nur andere Videos
   * desselben Projekts sehen, stehen mit zur Wahl; für sie ist dieses Video
   * genauso neu wie für jemanden von außerhalb.
   */
  /** Dasselbe für ein Video – das Projekt dazu wird hier nachgeschlagen. */
  async listVideoCandidates(videoId: string): Promise<GuestCandidateDto[]> {
    const [video] = await this.db
      .select({ projectId: videos.projectId })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1);
    if (!video) throw new NotFoundException('Video nicht gefunden.');
    return this.listCandidates(video.projectId, videoId);
  }

  async listCandidates(projectId: string, videoId?: string): Promise<GuestCandidateDto[]> {
    const [project] = await this.db
      .select({ id: projects.id, customer: projects.customer })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException('Projekt nicht gefunden.');

    const kunde = project.customer?.trim();
    if (!kunde) return [];

    // Wer schon sieht, worum es geht, steht nicht zur Wahl.
    const schonDa = new Set(
      (videoId ? await this.listForVideo(videoId) : await this.listForProject(projectId))
        .filter((eintrag) => eintrag.canView)
        .map((eintrag) => eintrag.user.id),
    );

    const rows = await this.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        projectId: sql<string>`coalesce(${shareLinks.projectId}, ${videos.projectId})`,
        projectName: projects.name,
      })
      .from(shareLinkGrants)
      .innerJoin(users, eq(users.id, shareLinkGrants.userId))
      .innerJoin(shareLinks, eq(shareLinks.id, shareLinkGrants.shareLinkId))
      .leftJoin(videos, eq(videos.id, shareLinks.videoId))
      .innerJoin(
        projects,
        eq(projects.id, sql`coalesce(${shareLinks.projectId}, ${videos.projectId})`),
      )
      .where(
        and(
          eq(users.role, 'GUEST'),
          eq(users.isActive, true),
          isNull(shareLinkGrants.revokedAt),
          isNull(shareLinks.revokedAt),
          // Kunden werden als Freitext geführt; Groß- und Kleinschreibung
          // sowie Leerzeichen am Rand dürfen nicht entscheiden.
          sql`lower(btrim(${projects.customer})) = lower(${kunde})`,
        ),
      );

    const byUser = new Map<string, GuestCandidateDto>();
    for (const row of rows) {
      if (schonDa.has(row.userId)) continue;
      let eintrag = byUser.get(row.userId);
      if (!eintrag) {
        eintrag = {
          user: { id: row.userId, name: row.name, email: row.email, role: 'GUEST' },
          fromProjects: [],
        };
        byUser.set(row.userId, eintrag);
      }
      // Beim Video zählt auch das eigene Projekt als Herkunft: Ein Gast, der
      // bisher nur andere Videos daraus sieht, kommt ja tatsächlich von dort,
      // und ohne diese Zeile fiele er unten aus der Liste.
      if (
        (videoId !== undefined || row.projectId !== projectId) &&
        !eintrag.fromProjects.some((treffer) => treffer.id === row.projectId)
      ) {
        eintrag.fromProjects.push({ id: row.projectId, name: row.projectName });
      }
    }

    return [...byUser.values()]
      .filter((eintrag) => eintrag.fromProjects.length > 0)
      .sort((left, right) => left.user.name.localeCompare(right.user.name, 'de'));
  }

  /** Gastkonto sperren oder entsperren – wirkt über alle Projekte hinweg. */
  async setAccountActive(userId: string, isActive: boolean): Promise<GuestOverviewDto[]> {
    const [row] = await this.db
      .update(users)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.role, 'GUEST')))
      .returning();
    if (!row) throw new NotFoundException('Gastkonto nicht gefunden.');

    this.logger.log(`Gastkonto ${row.email} ${isActive ? 'entsperrt' : 'gesperrt'}.`);
    return this.listAll();
  }

  // ---------- Hilfsmittel ----------

  /** Projektfreigaben und Videofreigaben innerhalb des Projekts. */
  /**
   * Rechte einer Person an einem Link setzen (Phase 16). `null` bedeutet
   * „wie der Link“ – so kommt man auch wieder zurück zum Standard.
   */
  async setGuestRights(
    shareLinkId: string,
    userId: string,
    rechte: {
      allowComments?: boolean | null;
      allowDownload?: boolean | null;
      allowUpload?: boolean | null;
      /** Externer Projektadmin (Phase 21) – kein „wie der Link", immer explizit. */
      projectAdmin?: boolean;
    },
  ): Promise<void> {
    if (rechte.projectAdmin) {
      const link = await this.getLinkOrFail(shareLinkId);
      // Eine einzelne Videofreigabe hat keinen Projektrahmen, in dem sich
      // „Projektadmin" verwalten ließe – Videos anlegen, weiter freigeben
      // usw. ergäbe dort keinen Sinn.
      if (link.scope !== 'PROJECT') {
        throw new BadRequestException(
          'Externer Projektadmin geht nur über eine Projektfreigabe, nicht über eine einzelne Videofreigabe.',
        );
      }
    }

    const [row] = await this.db
      .update(shareLinkGrants)
      .set({
        allowComments: rechte.allowComments,
        allowDownload: rechte.allowDownload,
        allowUpload: rechte.allowUpload,
        projectAdmin: rechte.projectAdmin,
      })
      .where(
        and(
          eq(shareLinkGrants.shareLinkId, shareLinkId),
          eq(shareLinkGrants.userId, userId),
        ),
      )
      .returning({ userId: shareLinkGrants.userId });
    if (!row) throw new NotFoundException('Dieser Gast kommt nicht über diesen Link herein.');
  }

  private async getLinkOrFail(shareLinkId: string): Promise<{ scope: 'PROJECT' | 'VIDEO' }> {
    const [link] = await this.db
      .select({ scope: shareLinks.scope })
      .from(shareLinks)
      .where(eq(shareLinks.id, shareLinkId))
      .limit(1);
    if (!link) throw new NotFoundException('Freigabe nicht gefunden.');
    return link;
  }

  private async linkIdsForProject(projectId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .leftJoin(videos, eq(shareLinks.videoId, videos.id))
      .where(or(eq(shareLinks.projectId, projectId), eq(videos.projectId, projectId)));
    return rows.map((row) => row.id);
  }

  private async loadGrants(linkIds: string[]): Promise<GuestGrantRow[]> {
    if (linkIds.length === 0) return [];

    const rows = await this.db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        userActive: users.isActive,
        shareLinkId: shareLinks.id,
        label: shareLinks.label,
        scope: shareLinks.scope,
        isDirect: shareLinks.isDirect,
        linkProjectId: shareLinks.projectId,
        linkVideoId: shareLinks.videoId,
        projectName: projects.name,
        videoName: videos.name,
        allowComments: shareLinks.allowComments,
        allowDownload: shareLinks.allowDownload,
        allowUpload: shareLinks.allowUpload,
        grantAllowComments: shareLinkGrants.allowComments,
        grantAllowDownload: shareLinkGrants.allowDownload,
        grantAllowUpload: shareLinkGrants.allowUpload,
        projectAdmin: shareLinkGrants.projectAdmin,
        linkRevokedAt: shareLinks.revokedAt,
        expiresAt: shareLinks.expiresAt,
        revokedAt: shareLinkGrants.revokedAt,
        firstSeenAt: shareLinkGrants.createdAt,
        lastSeenAt: shareLinkGrants.lastSeenAt,
      })
      .from(shareLinkGrants)
      .innerJoin(shareLinks, eq(shareLinks.id, shareLinkGrants.shareLinkId))
      .innerJoin(users, eq(users.id, shareLinkGrants.userId))
      .leftJoin(videos, eq(videos.id, shareLinks.videoId))
      .leftJoin(projects, eq(projects.id, shareLinks.projectId))
      .where(inArray(shareLinkGrants.shareLinkId, linkIds));

    return rows.map((row) => ({
      userId: row.userId,
      name: row.name,
      email: row.email,
      userActive: row.userActive,
      shareLinkId: row.shareLinkId,
      label: row.label,
      scope: row.scope,
      targetName: row.scope === 'VIDEO' ? (row.videoName ?? 'Video') : (row.projectName ?? 'Projekt'),
      targetId: (row.scope === 'VIDEO' ? row.linkVideoId : row.linkProjectId) ?? '',
      isDirect: row.isDirect,
      // Eine Ausnahme an der Person ersetzt das Link-Recht (Phase 16) –
      // dieselbe Regel wie im AccessService, damit Anzeige und Wirkung
      // nicht auseinanderlaufen.
      allowComments: row.grantAllowComments ?? row.allowComments,
      allowDownload: row.grantAllowDownload ?? row.allowDownload,
      allowUpload: row.grantAllowUpload ?? row.allowUpload,
      // Nur an einer Projektfreigabe möglich – am Schreiben durchgesetzt.
      projectAdmin: row.scope === 'PROJECT' && row.projectAdmin,
      /** Weicht diese Person vom Link ab? Für den Hinweis in der Oberfläche. */
      hasOverride:
        row.grantAllowComments !== null ||
        row.grantAllowDownload !== null ||
        row.grantAllowUpload !== null,
      linkActive: isLinkActive({ revokedAt: row.linkRevokedAt, expiresAt: row.expiresAt }),
      revokedAt: row.revokedAt,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
    }));
  }
}
