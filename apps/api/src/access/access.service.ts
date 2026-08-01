import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { RequestUser } from '../auth/auth.types';
import { DB, type Database } from '../db/db.module';
import { shareLinkGrants, shareLinks, videoVersions, videos } from '../db/schema';
import {
  type AccessScope,
  type GrantedShare,
  canComment,
  canDownloadVersion,
  canSeeInternalVersions,
  canUploadToProject,
  canViewProject,
  canViewVideo,
  guestScope,
  isProjectAdmin,
  isProjectAdminAnywhere,
  teamScope,
  visibleProjectIds,
  visibleVideoIdsForProject,
} from './access-scope';

export type { AccessScope };

/**
 * Bindeglied zwischen den Freigaben in der Datenbank und den Regeln in
 * `access-scope.ts`.
 *
 * Der Zugriff eines Gastes wird pro Anfrage frisch geladen. Das ist eine
 * kleine Abfrage – Gäste haben in aller Regel eine Handvoll Freigaben – und
 * sorgt dafür, dass ein zurückgezogener Link sofort wirkt und nicht erst,
 * wenn das Sitzungs-Token abläuft.
 */
/**
 * So oft wird höchstens vermerkt, dass ein Gast da war. Jede Anfrage zu
 * schreiben wäre Verschwendung – für die Frage „hat der Kunde reingeschaut?“
 * genügt eine Auflösung von Minuten.
 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);
  /** Wann zuletzt für einen Gast geschrieben wurde. */
  private readonly lastTouch = new Map<string, number>();

  constructor(@Inject(DB) private readonly db: Database) {}

  async loadScope(user: RequestUser): Promise<AccessScope> {
    if (user.role !== 'GUEST') return teamScope(user.role);

    this.noteVisit(user);

    const now = new Date();
    const rows = await this.db
      .select({
        shareLinkId: shareLinks.id,
        scope: shareLinks.scope,
        projectId: shareLinks.projectId,
        videoId: shareLinks.videoId,
        videoProjectId: videos.projectId,
        allowDownload: shareLinks.allowDownload,
        allowUpload: shareLinks.allowUpload,
        allowComments: shareLinks.allowComments,
        grantAllowDownload: shareLinkGrants.allowDownload,
        grantAllowUpload: shareLinkGrants.allowUpload,
        grantAllowComments: shareLinkGrants.allowComments,
        projectAdmin: shareLinkGrants.projectAdmin,
      })
      .from(shareLinkGrants)
      .innerJoin(shareLinks, eq(shareLinkGrants.shareLinkId, shareLinks.id))
      // Bei einer Videofreigabe steht das Projekt am Video, nicht am Link.
      .leftJoin(videos, eq(shareLinks.videoId, videos.id))
      .where(
        and(
          eq(shareLinkGrants.userId, user.id),
          isNull(shareLinkGrants.revokedAt),
          isNull(shareLinks.revokedAt),
          or(isNull(shareLinks.expiresAt), gt(shareLinks.expiresAt, now)),
        ),
      );

    const shares: GrantedShare[] = [];
    for (const row of rows) {
      const projectId = row.scope === 'PROJECT' ? row.projectId : row.videoProjectId;
      // Zeigt der Link ins Leere (Ziel gelöscht), gibt es nichts freizugeben.
      if (!projectId) continue;
      shares.push({
        shareLinkId: row.shareLinkId,
        scope: row.scope,
        projectId,
        videoId: row.scope === 'VIDEO' ? row.videoId : null,
        // Eine Ausnahme an der Person ersetzt das Link-Recht (Phase 16).
        allowDownload: row.grantAllowDownload ?? row.allowDownload,
        allowUpload: row.grantAllowUpload ?? row.allowUpload,
        allowComments: row.grantAllowComments ?? row.allowComments,
        // Nur an einer Projektfreigabe möglich – am Schreiben (`setGuestRights`)
        // durchgesetzt, hier nur noch übernommen.
        projectAdmin: row.scope === 'PROJECT' && row.projectAdmin,
      });
    }

    return guestScope(shares);
  }

  /**
   * Merkt sich, wann ein Gast zuletzt da war – Grundlage für die Spalte
   * „zuletzt gesehen“ in der Gästeübersicht.
   *
   * Bewusst nebenher und ohne `await`: Der Vermerk ist eine Bequemlichkeit für
   * die Übersicht, kein Teil der Antwort. Klemmt die Datenbank dabei, soll der
   * Gast trotzdem sein Video sehen.
   */
  private noteVisit(user: RequestUser): void {
    const now = Date.now();
    const last = this.lastTouch.get(user.id) ?? 0;
    if (now - last < TOUCH_INTERVAL_MS) return;
    this.lastTouch.set(user.id, now);

    void this.touchGrants(user).catch((error: unknown) => {
      this.logger.warn(
        `Letzter Zugriff für ${user.id} konnte nicht vermerkt werden: ${String(error)}`,
      );
    });
  }

  async touchGrants(user: RequestUser): Promise<void> {
    if (user.role !== 'GUEST') return;
    await this.db
      .update(shareLinkGrants)
      .set({ lastSeenAt: sql`now()` })
      .where(eq(shareLinkGrants.userId, user.id));
  }

  // ---------- Prüfungen mit klarer Fehlermeldung ----------

  /**
   * Fehlender Zugriff wird als „nicht gefunden“ gemeldet, nicht als
   * „verboten“: Sonst könnte ein Gast durch Ausprobieren von IDs herausfinden,
   * welche Projekte es sonst noch gibt.
   */
  assertCanViewProject(scope: AccessScope, projectId: string): void {
    if (!canViewProject(scope, projectId)) {
      throw new NotFoundException('Projekt nicht gefunden.');
    }
  }

  assertCanViewVideo(scope: AccessScope, video: { id: string; projectId: string }): void {
    if (!canViewVideo(scope, video)) {
      throw new NotFoundException('Video nicht gefunden.');
    }
  }

  assertCanComment(scope: AccessScope, video: { id: string; projectId: string }): void {
    this.assertCanViewVideo(scope, video);
    if (!canComment(scope, video)) {
      throw new ForbiddenException('Für diese Freigabe ist das Kommentieren nicht erlaubt.');
    }
  }

  assertCanUploadToProject(scope: AccessScope, projectId: string): void {
    this.assertCanViewProject(scope, projectId);
    if (!canUploadToProject(scope, projectId)) {
      throw new ForbiddenException('Für diese Freigabe ist das Hochladen nicht erlaubt.');
    }
  }

  /**
   * Team oder externer Projektadmin (Phase 21) – für das, was sonst nur dem
   * Team vorbehalten ist: Videos anlegen, Fassungen hochladen und löschen,
   * weiter freigeben, fremde Kommentare verwalten.
   */
  canManageProject(scope: AccessScope, projectId: string): boolean {
    return isProjectAdmin(scope, projectId);
  }

  assertCanManageProject(scope: AccessScope, projectId: string): void {
    this.assertCanViewProject(scope, projectId);
    if (!this.canManageProject(scope, projectId)) {
      throw new ForbiddenException('Dafür fehlen in diesem Projekt die Rechte.');
    }
  }

  /**
   * Ist die Person irgendwo ein externer Projektadmin? Für Prüfungen ohne
   * bekanntes Zielprojekt, etwa das Anlegen einer noch nicht zugeordneten
   * Upload-Sitzung.
   */
  canManageAnyProject(scope: AccessScope): boolean {
    return isProjectAdminAnywhere(scope);
  }

  /** Video samt Projektzugehörigkeit laden und Sichtbarkeit prüfen. */
  async requireVideo(
    scope: AccessScope,
    videoId: string,
  ): Promise<{ id: string; projectId: string; downloadsEnabled: boolean }> {
    const [row] = await this.db
      .select({
        id: videos.id,
        projectId: videos.projectId,
        downloadsEnabled: videos.downloadsEnabled,
      })
      .from(videos)
      .where(eq(videos.id, videoId))
      .limit(1);
    if (!row) throw new NotFoundException('Video nicht gefunden.');
    this.assertCanViewVideo(scope, row);
    return row;
  }

  /**
   * Version laden und Sichtbarkeit über ihr Video prüfen.
   *
   * Hier hängt seit Phase 27 auch die Regel für interne Fassungen: Jeder Weg
   * zu einer einzelnen Fassung – ansehen, kommentieren, herunterladen, Medien
   * abrufen – kommt hier vorbei. Eine Prüfung an einer Stelle ist mehr wert
   * als sieben verstreute, von denen die achte vergessen wird.
   */
  async requireVersion(
    scope: AccessScope,
    versionId: string,
  ): Promise<{
    versionId: string;
    videoId: string;
    projectId: string;
    videoDownloadsEnabled: boolean;
    versionDownloadEnabled: boolean;
    internal: boolean;
  }> {
    const [row] = await this.db
      .select({
        versionId: videoVersions.id,
        videoId: videos.id,
        projectId: videos.projectId,
        videoDownloadsEnabled: videos.downloadsEnabled,
        versionDownloadEnabled: videoVersions.downloadEnabled,
        internal: videoVersions.internal,
      })
      .from(videoVersions)
      .innerJoin(videos, eq(videoVersions.videoId, videos.id))
      .where(eq(videoVersions.id, versionId))
      .limit(1);
    if (!row) throw new NotFoundException('Version nicht gefunden.');
    this.assertCanViewVideo(scope, { id: row.videoId, projectId: row.projectId });
    // „Nicht gefunden“ und nicht „verboten“: Für einen Gast gibt es diese
    // Fassung schlicht nicht, und die Antwort soll auch nicht verraten, dass
    // im Haus gerade an einer gearbeitet wird.
    if (row.internal && !this.canSeeInternal(scope)) {
      throw new NotFoundException('Version nicht gefunden.');
    }
    return row;
  }

  /** Interne Fassungen (Phase 27) sieht nur das Team – Gäste nie. */
  canSeeInternal(scope: AccessScope): boolean {
    return canSeeInternalVersions(scope);
  }

  canDownload(
    scope: AccessScope,
    version: {
      videoId: string;
      projectId: string;
      videoDownloadsEnabled: boolean;
      versionDownloadEnabled: boolean;
    },
  ): boolean {
    return canDownloadVersion(scope, {
      video: { id: version.videoId, projectId: version.projectId },
      videoDownloadsEnabled: version.videoDownloadsEnabled,
      versionDownloadEnabled: version.versionDownloadEnabled,
    });
  }

  assertCanDownload(
    scope: AccessScope,
    version: {
      videoId: string;
      projectId: string;
      videoDownloadsEnabled: boolean;
      versionDownloadEnabled: boolean;
    },
  ): void {
    if (!this.canDownload(scope, version)) {
      throw new ForbiddenException('Für diese Fassung ist kein Download freigegeben.');
    }
  }

  visibleProjects(scope: AccessScope): string[] {
    return visibleProjectIds(scope);
  }

  visibleVideos(scope: AccessScope, projectId: string): string[] | null {
    return visibleVideoIdsForProject(scope, projectId);
  }

  canUpload(scope: AccessScope, projectId: string): boolean {
    return canUploadToProject(scope, projectId);
  }

  canCommentOn(scope: AccessScope, video: { id: string; projectId: string }): boolean {
    return canComment(scope, video);
  }
}
