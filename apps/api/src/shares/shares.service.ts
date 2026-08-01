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
      .where(
        and(
          or(eq(shareLinks.projectId, projectId), eq(videos.projectId, projectId)),
          // Einbett-Links sind keine Freigaben und stehen deshalb nicht in
          // dieser Liste (Phase 23) – sie haben ihr eigenes Fenster.
          eq(shareLinks.isEmbed, false),
        ),
      )
      .orderBy(desc(shareLinks.createdAt));

    return Promise.all(rows.map((row) => this.findOneOrFail(row.id)));
  }

  async listForVideo(videoId: string): Promise<ShareLinkDto[]> {
    const rows = await this.db
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .where(and(eq(shareLinks.videoId, videoId), eq(shareLinks.isEmbed, false)))
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
        role: users.role,
      })
      .from(shareLinkGrants)
      .innerJoin(users, eq(shareLinkGrants.userId, users.id))
      .where(eq(shareLinkGrants.shareLinkId, shareLinkId))
      .orderBy(desc(shareLinkGrants.lastSeenAt));

    return rows.map((row) => ({
      user: { id: row.id, name: row.name, email: row.email, role: row.role },
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
  async requestCode(token: string, input: { email: string }): Promise<void> {
    const link = await this.getByTokenOrFail(token);
    if (!isLinkActive(link)) {
      throw new GoneException('Diese Freigabe ist abgelaufen oder wurde zurückgezogen.');
    }

    const email = normalizeEmail(input.email);

    const [existing] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing && existing.role !== 'GUEST') {
      throw new ConflictException(
        'Diese Adresse gehört zu einem Team-Konto. Bitte über die normale Anmeldung einloggen.',
      );
    }
    if (existing && !existing.isActive) {
      throw new ForbiddenException('Dieser Zugang wurde gesperrt.');
    }
    // Wem der Zugriff entzogen wurde, dem nützt der alte Link nichts mehr
    // (Phase 20). Die Prüfung steht hier und nicht erst beim Einlösen: Sonst
    // ginge eine Code-Mail an jemanden raus, der ohnehin nicht hereinkommt,
    // und die Absage käme erst, nachdem er den Code abgetippt hat.
    if (existing) await this.pruefeEntzug(link.id, existing.id);

    await this.pruefeCodeBremse(email);

    const code = createLoginCode();
    await this.db.insert(loginCodes).values({
      email,
      codeHash: await hashPassword(code),
      shareLinkId: link.id,
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
    });

    const target = await this.describeTarget(link);
    await this.mailService.send(
      email,
      renderGuestCodeMail({
        brand: await this.mailService.brand(),
        // Ein Gast, der zum ersten Mal hereinkommt, hat noch keine eigene
        // Wahl – dann gilt die Vorgabe des Workspace (Phase 26).
        locale: await this.mailService.localeFor(await this.gastSprache(email)),
        code,
        targetName: target.targetName,
        minutesValid: CODE_TTL_MINUTES,
      }),
      // Nicht abschaltbar: Ohne den Code kommt kein Gast herein.
      { kind: 'guest-code', audience: 'GUEST' },
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
  ): Promise<{
    user: UserRow;
    link: ShareLinkRow;
    /** Beim allerersten Anmelden fehlt der Name noch (Phase 20). */
    needsName: boolean;
    redirectPath: string;
  }> {
    const link = await this.getByTokenOrFail(token);
    if (!isLinkActive(link)) {
      throw new GoneException('Diese Freigabe ist abgelaufen oder wurde zurückgezogen.');
    }
    if (!isLoginCodeShaped(input.code)) {
      throw new BadRequestException('Der Code besteht aus sechs Ziffern.');
    }

    const email = normalizeEmail(input.email);
    const candidate = await this.zieheCode(email, link.id);

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

    const user = await this.upsertGuest(email);

    // Noch einmal, jetzt mit dem tatsächlichen Konto: Zwischen Anfordern und
    // Einlösen können fünfzehn Minuten liegen, und ein Entzug in dieser Zeit
    // soll greifen. Vor dem Schreiben, damit ein entzogener Zugang nicht
    // nebenbei ein `lastSeenAt` bekommt.
    await this.pruefeEntzug(link.id, user.id);

    await this.db
      .insert(shareLinkGrants)
      .values({ shareLinkId: link.id, userId: user.id })
      .onConflictDoUpdate({
        target: [shareLinkGrants.shareLinkId, shareLinkGrants.userId],
        // Ein erneutes Anmelden hebt einen früheren Entzug nicht auf – der
        // wäre oben schon aufgefallen.
        set: { lastSeenAt: sql`now()` },
      });

    this.logger.log(`Gast angemeldet: ${user.email} über Freigabe ${link.id}`);

    return {
      user,
      link,
      needsName: !user.nameConfirmed,
      redirectPath: zielPfad(link),
    };
  }

  // ---------- Gastzugang ohne Link (Phase 20) ----------

  /**
   * „Gastzugang" auf der Anmeldeseite: Code anfordern, ohne einen Link zur
   * Hand zu haben. Für den Kunden, der den alten Link nicht mehr findet.
   *
   * **Für eine unbekannte Adresse geht keine Mail raus.** Sonst wäre das hier
   * eine Selbstregistrierung: Jeder könnte sich eintragen und bekäme Post von
   * dieser Anlage. Dass die Absage damit verrät, ob eine Adresse als Gast
   * angelegt ist, ist der bewusst in Kauf genommene Preis – die Anfragebremse
   * davor begrenzt, wie oft sich das ausprobieren lässt.
   */
  async requestGuestLoginCode(email: string): Promise<void> {
    const adresse = normalizeEmail(email);
    const [user] = await this.db.select().from(users).where(eq(users.email, adresse)).limit(1);

    if (!user || user.role !== 'GUEST') {
      throw new NotFoundException(
        'Zu dieser Adresse gibt es keinen Gastzugang. Bitte den Freigabe-Link benutzen, den du bekommen hast.',
      );
    }
    if (!user.isActive) throw new ForbiddenException('Dieser Zugang wurde gesperrt.');

    const [{ offen }] = await this.db
      .select({ offen: count() })
      .from(shareLinkGrants)
      .innerJoin(shareLinks, eq(shareLinks.id, shareLinkGrants.shareLinkId))
      .where(
        and(
          eq(shareLinkGrants.userId, user.id),
          isNull(shareLinkGrants.revokedAt),
          isNull(shareLinks.revokedAt),
        ),
      );
    if (offen === 0) {
      throw new ForbiddenException(
        'Für diesen Zugang ist derzeit nichts freigegeben. Bitte frage nach einem neuen Link.',
      );
    }

    await this.pruefeCodeBremse(adresse);

    const code = createLoginCode();
    await this.db.insert(loginCodes).values({
      email: adresse,
      codeHash: await hashPassword(code),
      // Ohne Link: Dieser Code gilt für die Anmeldung als solche, nicht für
      // eine bestimmte Freigabe.
      shareLinkId: null,
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000),
    });

    const brand = await this.mailService.brand();
    await this.mailService.send(
      adresse,
      renderGuestCodeMail({
        brand,
        locale: await this.mailService.localeFor(await this.gastSprache(adresse)),
        code,
        targetName: brand.title,
        minutesValid: CODE_TTL_MINUTES,
      }),
      { kind: 'guest-code', audience: 'GUEST' },
    );
  }

  /** Den Code von der Anmeldeseite einlösen. */
  async verifyGuestLogin(input: {
    email: string;
    code: string;
  }): Promise<{ user: UserRow; redirectPath: string }> {
    if (!isLoginCodeShaped(input.code)) {
      throw new BadRequestException('Der Code besteht aus sechs Ziffern.');
    }
    const adresse = normalizeEmail(input.email);
    const candidate = await this.zieheCode(adresse, null);

    const [user] = await this.db.select().from(users).where(eq(users.email, adresse)).limit(1);
    if (!user || user.role !== 'GUEST' || !user.isActive) {
      throw new ForbiddenException('Dieser Zugang steht nicht mehr offen.');
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
    await this.db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, user.id));

    this.logger.log(`Gast angemeldet: ${user.email} über den Gastzugang`);
    return { user, redirectPath: await this.startseiteFuer(user.id) };
  }

  /**
   * Wohin nach dem Anmelden ohne Link? Wer genau eine Videofreigabe hat, will
   * dieses Video sehen – bei allem anderen ist die Projektliste der richtige
   * Ausgangspunkt.
   */
  private async startseiteFuer(userId: string): Promise<string> {
    const rows = await this.db
      .select({ scope: shareLinks.scope, videoId: shareLinks.videoId })
      .from(shareLinkGrants)
      .innerJoin(shareLinks, eq(shareLinks.id, shareLinkGrants.shareLinkId))
      .where(
        and(
          eq(shareLinkGrants.userId, userId),
          isNull(shareLinkGrants.revokedAt),
          isNull(shareLinks.revokedAt),
        ),
      );
    if (rows.length === 1 && rows[0].scope === 'VIDEO' && rows[0].videoId) {
      return `/videos/${rows[0].videoId}`;
    }
    return '/projekte';
  }

  /** Fünf Codes je Adresse und Stunde – für beide Wege dieselbe Grenze. */
  private async pruefeCodeBremse(email: string): Promise<void> {
    const [{ recent }] = await this.db
      .select({ recent: count() })
      .from(loginCodes)
      .where(
        and(eq(loginCodes.email, email), gt(loginCodes.createdAt, new Date(Date.now() - 60 * 60 * 1000))),
      );
    if (recent >= MAX_CODES_PER_HOUR) {
      throw new HttpException(
        'Es wurden zu viele Codes angefordert. Bitte in einer Stunde erneut versuchen.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Den jüngsten offenen Code zu dieser Adresse holen. `shareLinkId === null`
   * meint den Gastzugang ohne Link – ein Code für eine bestimmte Freigabe
   * taugt dafür ausdrücklich nicht.
   */
  private async zieheCode(email: string, shareLinkId: string | null) {
    const [candidate] = await this.db
      .select()
      .from(loginCodes)
      .where(
        and(
          eq(loginCodes.email, email),
          shareLinkId === null
            ? isNull(loginCodes.shareLinkId)
            : eq(loginCodes.shareLinkId, shareLinkId),
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
    return candidate;
  }

  /**
   * Der Gast gibt seinen Namen an – einmal, beim ersten Besuch (Phase 20).
   *
   * Danach ist der Weg zu. Das ist kein Umbenennen-Verbot aus Prinzip,
   * sondern die Absicherung eines Schritts, der genau einmal vorkommt: Ohne
   * sie wäre der Endpunkt eine offene Möglichkeit, sich jederzeit anders zu
   * nennen – auch mitten in einem laufenden Gespräch.
   */
  async confirmName(userId: string, name: string): Promise<UserRow> {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) throw new NotFoundException('Konto nicht gefunden.');
    if (row.nameConfirmed) {
      throw new ConflictException('Der Name steht schon fest.');
    }

    const [updated] = await this.db
      .update(users)
      .set({ name: normalizeName(name), nameConfirmed: true, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  }

  /**
   * Der Gast ist schon angemeldet und ruft den Link erneut auf (Phase 20).
   *
   * Bisher stand er dann wieder vor der Maske und musste Name, Adresse und
   * Code noch einmal eingeben – obwohl die Sitzung längst gültig war. Jetzt
   * geht es direkt weiter.
   *
   * Der Link bleibt der Zugangsschutz: Wer ihn hat und angemeldet ist, kommt
   * herein, genau wie über den Code. Ein entzogener Zugriff bleibt entzogen,
   * und für das eigene Team wird gar kein Gasteintrag angelegt – die sehen
   * ohnehin alles.
   */
  async continueWithSession(
    token: string,
    user: { id: string; role: string },
  ): Promise<{ redirectPath: string }> {
    const link = await this.getByTokenOrFail(token);
    if (!isLinkActive(link)) {
      throw new GoneException('Diese Freigabe ist abgelaufen oder wurde zurückgezogen.');
    }

    if (user.role !== 'GUEST') return { redirectPath: zielPfad(link) };

    await this.pruefeEntzug(link.id, user.id);
    await this.db
      .insert(shareLinkGrants)
      .values({ shareLinkId: link.id, userId: user.id })
      .onConflictDoUpdate({
        target: [shareLinkGrants.shareLinkId, shareLinkGrants.userId],
        set: { lastSeenAt: sql`now()` },
      });

    return { redirectPath: zielPfad(link) };
  }

  /**
   * Ein Zugang, der einmal entzogen wurde, lässt sich nicht durch erneutes
   * Anmelden zurückholen (Phase 20). Wer wieder hereinwill, braucht eine neue
   * Freigabe – das ist eine Entscheidung des Teams, keine des Gastes.
   */
  private async pruefeEntzug(shareLinkId: string, userId: string): Promise<void> {
    const [grant] = await this.db
      .select({ revokedAt: shareLinkGrants.revokedAt })
      .from(shareLinkGrants)
      .where(
        and(eq(shareLinkGrants.shareLinkId, shareLinkId), eq(shareLinkGrants.userId, userId)),
      )
      .limit(1);
    if (grant?.revokedAt) {
      throw new ForbiddenException(
        'Dein Zugriff auf diese Freigabe wurde zurückgezogen. Bitte frage nach einem neuen Link.',
      );
    }
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
            .select({ id: users.id, name: users.name, email: users.email, role: users.role })
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
      isDirect: link.isDirect,
      expiresAt: link.expiresAt?.toISOString() ?? null,
      revokedAt: link.revokedAt?.toISOString() ?? null,
      isActive: isLinkActive(link),
      url: `${this.config.publicUrl}/f/${link.token}`,
      createdAt: link.createdAt.toISOString(),
      createdBy: creator
        ? { id: creator.id, name: creator.name, email: creator.email, role: creator.role }
        : null,
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
    // Ein Einbett-Token ist kein Zugang (Phase 23): Er zeigt einen Player auf
    // einer fremden Seite, mehr nicht. Dieselbe Meldung wie bei einem
    // erfundenen Token – dass er als Einbettung existiert, geht niemanden
    // etwas an, der ihn hier ausprobiert.
    if (!row || row.isEmbed) throw new NotFoundException('Diese Freigabe gibt es nicht.');
    return row;
  }

  // ---------- Einbetten (Phase 23) ----------

  /**
   * Der Einbett-Link eines Videos, falls es einen gibt.
   *
   * Höchstens einer je Video: Zwei Adressen für dieselbe Einbettung wären
   * nichts als eine zusätzliche Möglichkeit, die falsche zurückzuziehen.
   */
  async findEmbedLink(videoId: string): Promise<ShareLinkRow | null> {
    const [row] = await this.db
      .select()
      .from(shareLinks)
      .where(
        and(
          eq(shareLinks.videoId, videoId),
          eq(shareLinks.isEmbed, true),
          isNull(shareLinks.revokedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Legt den Einbett-Link an oder gibt den vorhandenen zurück. */
  async createEmbedLink(videoId: string, user: RequestUser): Promise<ShareLinkRow> {
    const vorhanden = await this.findEmbedLink(videoId);
    if (vorhanden) return vorhanden;

    const [row] = await this.db
      .insert(shareLinks)
      .values({
        token: createShareToken(),
        scope: 'VIDEO',
        videoId,
        label: 'Einbettung',
        isEmbed: true,
        // Am Einbett-Link hängen keine Rechte: Er liefert die Abspielfassung
        // der Endfassung, sonst nichts. Kein Download, kein Kommentieren,
        // kein Hochladen – auch nicht versehentlich.
        allowComments: false,
        allowDownload: false,
        allowUpload: false,
        createdById: user.id,
      })
      .returning();

    this.logger.log(`Einbett-Link für Video ${videoId} angelegt.`);
    return row;
  }

  /** Zieht den Einbett-Link zurück – die Einbettung ist damit sofort tot. */
  async revokeEmbedLink(videoId: string): Promise<void> {
    await this.db
      .update(shareLinks)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(shareLinks.videoId, videoId), eq(shareLinks.isEmbed, true)));
  }

  /** Namen von Ziel und Projekt für Anzeige und Mailtext. */
  /**
   * Die Sprachwahl eines Gastes, falls sein Konto schon besteht (Phase 26).
   * Beim allerersten Code gibt es noch keines – dann bleibt es bei der
   * Vorgabe des Workspace.
   */
  private async gastSprache(email: string): Promise<string | null> {
    const [row] = await this.db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return row?.locale ?? null;
  }

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

  /**
   * Gastkonto anlegen oder die Anmeldung vermerken (Phase 20).
   *
   * Der Name wird hier **nicht** mehr gesetzt: Ein bestehendes Konto behält
   * seinen, ein neues bekommt den Teil vor dem At-Zeichen als Notbehelf und
   * `nameConfirmed = false`. Danach fragt die Oberfläche genau einmal nach –
   * und nie wieder.
   */
  private async upsertGuest(email: string): Promise<UserRow> {
    const [existing] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) {
      const [updated] = await this.db
        .update(users)
        .set({ lastLoginAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await this.db
      .insert(users)
      .values({
        email,
        name: notnameAus(email),
        nameConfirmed: false,
        role: 'GUEST',
        passwordHash: null,
        lastLoginAt: new Date(),
      })
      .returning();
    return created;
  }
}

/** Wohin der Gast nach dem Anmelden springt. */
export function zielPfad(link: Pick<ShareLinkRow, 'scope' | 'videoId' | 'projectId'>): string {
  return link.scope === 'VIDEO' && link.videoId
    ? `/videos/${link.videoId}`
    : `/projekte/${link.projectId}`;
}

/**
 * `anna.meier@firma.de` → `anna.meier`. Nur ein Notbehelf, bis der Gast
 * seinen Namen selbst angibt – aber besser als ein leeres Feld oder ein
 * gleichlautendes „Gast" für alle.
 */
function notnameAus(email: string): string {
  const vorne = email.split('@')[0]?.trim();
  return vorne && vorne.length > 0 ? vorne.slice(0, 200) : 'Gast';
}

/** Aktiv heißt: nicht zurückgezogen und nicht abgelaufen. */
export function isLinkActive(link: Pick<ShareLinkRow, 'revokedAt' | 'expiresAt'>): boolean {
  if (link.revokedAt) return false;
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return false;
  return true;
}
