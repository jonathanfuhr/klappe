import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ShareGuestDto, ShareLinkDto, SharePreviewDto } from '@klappe/shared';
import { and, count, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '../auth/password';
import type { RequestUser } from '../auth/auth.types';
import { normalizeEmail, normalizeName } from '../common/normalize';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import {
  type ShareLinkRow,
  type UserRow,
  loginCodes,
  projects,
  shareLinkGrants,
  shareLinks,
  users,
  videos,
} from '../db/schema';
import { MailService } from '../mail/mail.service';
import { renderGuestCodeMail } from '../mail/templates';
import type { CreateShareLinkDto, UpdateShareLinkDto } from './shares.dto';
import { createLoginCode, createShareToken, isLoginCodeShaped } from './share-token';

const CODE_TTL_MINUTES = 15;
/** So viele Codes darf eine Adresse pro Stunde anfordern. */
const MAX_CODES_PER_HOUR = 5;
/** So oft darf ein Code falsch eingegeben werden, bevor er verbrennt. */
const MAX_CODE_ATTEMPTS = 5;

@Injectable()
export class SharesService {
  private readonly logger = new Logger(SharesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly mailService: MailService,
  ) {}

  // ---------- Verwaltung durch das Team ----------

  async create(dto: CreateShareLinkDto, user: RequestUser): Promise<ShareLinkDto> {
    if (dto.scope === 'PROJECT' && !dto.projectId) {
      throw new BadRequestException('Für eine Projektfreigabe fehlt die Projekt-ID.');
    }
    if (dto.scope === 'VIDEO' && !dto.videoId) {
      throw new BadRequestException('Für eine Videofreigabe fehlt die Video-ID.');
    }

    if (dto.scope === 'PROJECT') {
      const [project] = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, dto.projectId as string))
        .limit(1);
      if (!project) throw new NotFoundException('Projekt nicht gefunden.');
    } else {
      const [video] = await this.db
        .select({ id: videos.id })
        .from(videos)
        .where(eq(videos.id, dto.videoId as string))
        .limit(1);
      if (!video) throw new NotFoundException('Video nicht gefunden.');
    }

    // Ein Upload-Recht ergibt nur bei einer Projektfreigabe Sinn – der
    // Kunden-Ordner hängt am Projekt, nicht an einem einzelnen Video.
    const allowUpload = dto.scope === 'PROJECT' ? (dto.allowUpload ?? false) : false;

    const [row] = await this.db
      .insert(shareLinks)
      .values({
        token: createShareToken(),
        scope: dto.scope,
        projectId: dto.scope === 'PROJECT' ? dto.projectId : null,
        videoId: dto.scope === 'VIDEO' ? dto.videoId : null,
        label: dto.label?.trim() || null,
        allowDownload: dto.allowDownload ?? false,
        allowUpload,
        allowComments: dto.allowComments ?? true,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        createdById: user.id,
      })
      .returning();

    return this.findOneOrFail(row.id);
  }

  async update(id: string, dto: UpdateShareLinkDto): Promise<ShareLinkDto> {
    const existing = await this.getRowOrFail(id);

    const [row] = await this.db
      .update(shareLinks)
      .set({
        label: dto.label === undefined ? undefined : dto.label.trim() || null,
        allowDownload: dto.allowDownload,
        allowUpload:
          dto.allowUpload === undefined
            ? undefined
            : existing.scope === 'PROJECT'
              ? dto.allowUpload
              : false,
        allowComments: dto.allowComments,
        expiresAt: dto.expiresAt === undefined ? undefined : dto.expiresAt ? new Date(dto.expiresAt) : null,
        revokedAt: dto.revoked === undefined ? undefined : dto.revoked ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(shareLinks.id, id))
      .returning();

    return this.findOneOrFail(row.id);
  }

  async remove(id: string): Promise<void> {
    const [row] = await this.db.delete(shareLinks).where(eq(shareLinks.id, id)).returning();
    if (!row) throw new NotFoundException('Freigabe nicht gefunden.');
  }

  async listForProject(projectId: string): Promise<ShareLinkDto[]> {
    // Auch Videofreigaben innerhalb des Projekts gehören in die Übersicht –
    // sonst übersieht man leicht, was alles offen ist.
    const rows = await this.db
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .leftJoin(videos, eq(shareLinks.videoId, videos.id))
      .where(or(eq(shareLinks.projectId, projectId), eq(videos.projectId, projectId)))
      .orderBy(desc(shareLinks.createdAt));

    return Promise.all(rows.map((row) => this.findOneOrFail(row.id)));
  }

  async listForVideo(videoId: string): Promise<ShareLinkDto[]> {
    const rows = await this.db
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .where(eq(shareLinks.videoId, videoId))
      .orderBy(desc(shareLinks.createdAt));
    return Promise.all(rows.map((row) => this.findOneOrFail(row.id)));
  }

  /** Gäste, die diesen Link benutzt haben. */
  async listGuests(shareLinkId: string): Promise<ShareGuestDto[]> {
    const link = await this.getRowOrFail(shareLinkId);
    const rows = await this.db
      .select({
        grant: shareLinkGrants,
        id: users.id,
        name: users.name,
        email: users.email,
      })
      .from(shareLinkGrants)
      .innerJoin(users, eq(shareLinkGrants.userId, users.id))
      .where(eq(shareLinkGrants.shareLinkId, shareLinkId))
      .orderBy(desc(shareLinkGrants.lastSeenAt));

    return rows.map((row) => ({
      user: { id: row.id, name: row.name, email: row.email },
      shareLinkId,
      shareLabel: link.label,
      createdAt: row.grant.createdAt.toISOString(),
      lastSeenAt: row.grant.lastSeenAt.toISOString(),
      revokedAt: row.grant.revokedAt?.toISOString() ?? null,
    }));
  }

  /** Einzelnem Gast den Zugriff über diesen Link entziehen oder zurückgeben. */
  async setGuestRevoked(shareLinkId: string, userId: string, revoked: boolean): Promise<void> {
    const [row] = await this.db
      .update(shareLinkGrants)
      .set({ revokedAt: revoked ? new Date() : null })
      .where(
        and(eq(shareLinkGrants.shareLinkId, shareLinkId), eq(shareLinkGrants.userId, userId)),
      )
      .returning();
    if (!row) throw new NotFoundException('Dieser Gast ist an der Freigabe nicht eingetragen.');
  }

  // ---------- Gastzugang ----------

  /** Was der Gast über den Link erfährt, bevor er Name und E-Mail angibt. */
  async preview(token: string): Promise<SharePreviewDto> {
    const link = await this.getByTokenOrFail(token);
    const target = await this.describeTarget(link);

    return {
      scope: link.scope,
      targetName: target.targetName,
      projectName: target.projectName,
      allowDownload: link.allowDownload,
      allowUpload: link.allowUpload,
      allowComments: link.allowComments,
      isActive: isLinkActive(link),
      mailReady: await this.mailService.isReady(),
    };
  }

  /**
   * Name und E-Mail entgegennehmen und einen Anmeldecode verschicken.
   *
   * Der Code geht bewusst *direkt* raus und nicht über die Warteschlange:
   * Wenn der Mailserver klemmt, soll der Gast das sofort erfahren und nicht
   * vergeblich auf eine Mail warten.
   */
  async requestCode(token: string, input: { name: string; email: string }): Promise<void> {
    const link = await this.getByTokenOrFail(token);
    if (!isLinkActive(link)) {
      throw new GoneException('Diese Freigabe ist abgelaufen oder wurde zurückgezogen.');
    }

    const email = normalizeEmail(input.email);
    const name = normalizeName(input.name);

    const [existing] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing && existing.role !== 'GUEST') {
      throw new ConflictException(
        'Diese Adresse gehört zu einem Team-Konto. Bitte über die normale Anmeldung einloggen.',
      );
    }
    if (existing && !existing.isActive) {
      throw new ForbiddenException('Dieser Zugang wurde gesperrt.');
    }

    const [{ recent }] = await this.db
      .select({ recent: count() })
      .from(loginCodes)
      .where(
        and(
          eq(loginCodes.email, email),
          gt(loginCodes.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
        ),
      );
    if (recent >= MAX_CODES_PER_HOUR) {
      throw new HttpException(
        'Es wurden zu viele Codes angefordert. Bitte in einer Stunde erneut versuchen.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = createLoginCode();
    await this.db.insert(loginCodes).values({
      email,
      name,
      codeHash: await hashPassword(code),
      shareLinkId: link.id,
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
    });

    const target = await this.describeTarget(link);
    await this.mailService.send(
      email,
      renderGuestCodeMail({
        code,
        targetName: target.targetName,
        minutesValid: CODE_TTL_MINUTES,
      }),
    );
  }

  /**
   * Code einlösen: Gastkonto anlegen oder wiederverwenden, Zugriff auf die
   * Freigabe eintragen und den Benutzer zurückgeben. Das Sitzungs-Cookie
   * setzt der Controller.
   */
  async verifyCode(
    token: string,
    input: { email: string; code: string },
  ): Promise<{ user: UserRow; link: ShareLinkRow; redirectPath: string }> {
    const link = await this.getByTokenOrFail(token);
    if (!isLinkActive(link)) {
      throw new GoneException('Diese Freigabe ist abgelaufen oder wurde zurückgezogen.');
    }
    if (!isLoginCodeShaped(input.code)) {
      throw new BadRequestException('Der Code besteht aus sechs Ziffern.');
    }

    const email = normalizeEmail(input.email);
    const [candidate] = await this.db
      .select()
      .from(loginCodes)
      .where(
        and(
          eq(loginCodes.email, email),
          eq(loginCodes.shareLinkId, link.id),
          isNull(loginCodes.consumedAt),
          gt(loginCodes.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(loginCodes.createdAt))
      .limit(1);

    if (!candidate) {
      throw new BadRequestException('Der Code ist abgelaufen. Bitte einen neuen anfordern.');
    }
    if (candidate.attempts >= MAX_CODE_ATTEMPTS) {
      throw new HttpException(
        'Zu viele Fehlversuche. Bitte einen neuen Code anfordern.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!(await verifyPassword(input.code.trim(), candidate.codeHash))) {
      await this.db
        .update(loginCodes)
        .set({ attempts: candidate.attempts + 1 })
        .where(eq(loginCodes.id, candidate.id));
      throw new BadRequestException('Der Code stimmt nicht.');
    }

    await this.db
      .update(loginCodes)
      .set({ consumedAt: new Date() })
      .where(eq(loginCodes.id, candidate.id));

    const user = await this.upsertGuest(email, candidate.name ?? 'Gast');

    await this.db
      .insert(shareLinkGrants)
      .values({ shareLinkId: link.id, userId: user.id })
      .onConflictDoUpdate({
        target: [shareLinkGrants.shareLinkId, shareLinkGrants.userId],
        // Ein erneutes Anmelden hebt einen früheren Entzug nicht auf.
        set: { lastSeenAt: sql`now()` },
      });

    const [grant] = await this.db
      .select()
      .from(shareLinkGrants)
      .where(
        and(eq(shareLinkGrants.shareLinkId, link.id), eq(shareLinkGrants.userId, user.id)),
      )
      .limit(1);
    if (grant?.revokedAt) {
      throw new ForbiddenException('Der Zugriff auf diese Freigabe wurde entzogen.');
    }

    this.logger.log(`Gast angemeldet: ${user.email} über Freigabe ${link.id}`);

    return {
      user,
      link,
      redirectPath:
        link.scope === 'VIDEO' && link.videoId
          ? `/videos/${link.videoId}`
          : `/projekte/${link.projectId}`,
    };
  }

  // ---------- Hilfsmittel ----------

  async findOneOrFail(id: string): Promise<ShareLinkDto> {
    const link = await this.getRowOrFail(id);
    const target = await this.describeTarget(link);

    const [{ guests }] = await this.db
      .select({ guests: count() })
      .from(shareLinkGrants)
      .where(eq(shareLinkGrants.shareLinkId, link.id));

    const creator = link.createdById
      ? (
          await this.db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, link.createdById))
            .limit(1)
        )[0]
      : undefined;

    return {
      id: link.id,
      token: link.token,
      scope: link.scope,
      projectId: link.projectId,
      videoId: link.videoId,
      targetName: target.targetName,
      label: link.label,
      allowDownload: link.allowDownload,
      allowUpload: link.allowUpload,
      allowComments: link.allowComments,
      expiresAt: link.expiresAt?.toISOString() ?? null,
      revokedAt: link.revokedAt?.toISOString() ?? null,
      isActive: isLinkActive(link),
      url: `${this.config.publicUrl}/f/${link.token}`,
      createdAt: link.createdAt.toISOString(),
      createdBy: creator ? { id: creator.id, name: creator.name, email: creator.email } : null,
      guestCount: guests,
    };
  }

  private async getRowOrFail(id: string): Promise<ShareLinkRow> {
    const [row] = await this.db.select().from(shareLinks).where(eq(shareLinks.id, id)).limit(1);
    if (!row) throw new NotFoundException('Freigabe nicht gefunden.');
    return row;
  }

  private async getByTokenOrFail(token: string): Promise<ShareLinkRow> {
    const [row] = await this.db
      .select()
      .from(shareLinks)
      .where(eq(shareLinks.token, token.trim().toLowerCase()))
      .limit(1);
    if (!row) throw new NotFoundException('Diese Freigabe gibt es nicht.');
    return row;
  }

  /** Namen von Ziel und Projekt für Anzeige und Mailtext. */
  private async describeTarget(
    link: ShareLinkRow,
  ): Promise<{ targetName: string; projectName: string }> {
    if (link.scope === 'PROJECT' && link.projectId) {
      const [project] = await this.db
        .select({ name: projects.name })
        .from(projects)
        .where(eq(projects.id, link.projectId))
        .limit(1);
      const name = project?.name ?? 'Projekt';
      return { targetName: name, projectName: name };
    }

    if (link.videoId) {
      const [row] = await this.db
        .select({ videoName: videos.name, projectName: projects.name })
        .from(videos)
        .innerJoin(projects, eq(videos.projectId, projects.id))
        .where(eq(videos.id, link.videoId))
        .limit(1);
      if (row) return { targetName: row.videoName, projectName: row.projectName };
    }

    return { targetName: 'Freigabe', projectName: 'Projekt' };
  }

  /** Gastkonto anlegen oder den Namen auffrischen. */
  private async upsertGuest(email: string, name: string): Promise<UserRow> {
    const [existing] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      const [updated] = await this.db
        .update(users)
        .set({ name, lastLoginAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await this.db
      .insert(users)
      .values({ email, name, role: 'GUEST', passwordHash: null, lastLoginAt: new Date() })
      .returning();
    return created;
  }
}

/** Aktiv heißt: nicht zurückgezogen und nicht abgelaufen. */
export function isLinkActive(link: Pick<ShareLinkRow, 'revokedAt' | 'expiresAt'>): boolean {
  if (link.revokedAt) return false;
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return false;
  return true;
}
