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
import { DB, type Database } from '../db/db.module';
import { projects, shareLinkGrants, shareLinks, users, videos } from '../db/schema';
import { createShareToken } from '../shares/share-token';
import { isLinkActive } from '../shares/shares.service';
import { type GuestGrantRow, summarizeGuests } from './guest-summary';

@Injectable()
export class GuestsService {
  private readonly logger = new Logger(GuestsService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

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
    /** Ohne Angabe: übernehmen, was der Gast im Projekt schon darf. */
    wunschRechte?: { allowComments?: boolean; allowDownload?: boolean; allowUpload?: boolean },
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
      allowComments: wunschRechte?.allowComments ?? bisher?.canComment ?? true,
      allowDownload: wunschRechte?.allowDownload ?? bisher?.canDownload ?? false,
      // Hochladen hängt am Projekt; bei einer Erweiterung auf Videos bleibt es aus.
      allowUpload:
        ziel.scope === 'PROJECT' ? (wunschRechte?.allowUpload ?? bisher?.canUpload ?? false) : false,
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
    return this.listForProject(projectId);
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
   */
  async listCandidates(projectId: string): Promise<GuestCandidateDto[]> {
    const [project] = await this.db
      .select({ id: projects.id, customer: projects.customer })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project) throw new NotFoundException('Projekt nicht gefunden.');

    const kunde = project.customer?.trim();
    if (!kunde) return [];

    // Wer im Projekt schon dabei ist, steht nicht zur Wahl.
    const schonDa = new Set(
      (await this.listForProject(projectId))
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
      if (
        row.projectId !== projectId &&
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
    },
  ): Promise<void> {
    const [row] = await this.db
      .update(shareLinkGrants)
      .set({
        allowComments: rechte.allowComments,
        allowDownload: rechte.allowDownload,
        allowUpload: rechte.allowUpload,
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
