/**
 * Wer kommt hier eigentlich herein?
 *
 * Freigabe-Links sind schnell erstellt und ebenso schnell vergessen. Diese
 * Übersicht dreht die Sicht um: nicht „welche Links gibt es", sondern „welche
 * Personen haben Zugriff und worüber". Nur so lässt sich der Zugang gezielt
 * entziehen, ohne einen Link zu killen, den andere noch brauchen.
 */
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { GuestAccessDto, GuestOverviewDto } from '@klappe/shared';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { projects, shareLinkGrants, shareLinks, users, videos } from '../db/schema';
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
          user: { id: row.userId, name: row.name, email: row.email },
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
