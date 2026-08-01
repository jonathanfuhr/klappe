import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { UserDto, UserRole, UserSummaryDto } from '@klappe/shared';
import { isLocale } from '@klappe/shared';
import { and, asc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { hashPassword, validatePasswordStrength } from '../auth/password';
import { normalizeEmail, normalizeName } from '../common/normalize';
import { DB, type Database } from '../db/db.module';
import { type UserRow, users } from '../db/schema';
import { AuthSettingsService } from '../settings/auth-settings.service';
import type { CreateUserDto, UpdateMeDto, UpdateUserDto } from './users.dto';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    /* Für die Passwort-Richtlinie des Workspace (Phase 24). */
    private readonly authSettings: AuthSettingsService,
  ) {}

  toDto(row: UserRow): UserDto {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      isActive: row.isActive,
      notificationsEnabled: row.notificationsEnabled,
      // Unsinn aus der Datenbank gilt als „keine eigene Wahl" (Phase 26).
      locale: isLocale(row.locale) ? row.locale : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  toSummary(row: Pick<UserRow, 'id' | 'name' | 'email' | 'role'>): UserSummaryDto {
    return { id: row.id, name: row.name, email: row.email, role: row.role };
  }

  /**
   * Die Konten des Teams. Gäste stehen seit Phase 20 nicht mehr dabei: Sie
   * sind Kundschaft, nicht Belegschaft, haben ihre eigene Seite mit den
   * Angaben, die dort zählen (über welche Freigabe, wann zuletzt da) – und
   * bei einem Dutzend Projekten waren sie in dieser Liste schlicht die
   * Mehrheit.
   */
  async list(): Promise<UserDto[]> {
    const rows = await this.db
      .select()
      .from(users)
      .where(ne(users.role, 'GUEST'))
      .orderBy(asc(users.name));
    return rows.map((row) => this.toDto(row));
  }

  /**
   * Kandidaten für @-Mentions. Bewusst nur aktive Konten und auf wenige
   * Treffer begrenzt – die Liste läuft bei jedem Tastendruck im Editor.
   *
   * Gäste bekommen ausschließlich Team-Mitglieder vorgeschlagen. Sonst
   * könnten sich zwei Kunden am selben Projekt gegenseitig aus der
   * Vorschlagsliste auslesen.
   */
  async searchMentionable(
    query: string,
    role: UserRole,
    limit = 8,
  ): Promise<UserSummaryDto[]> {
    const term = `%${query.trim()}%`;
    const rows = await this.db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(
        and(
          eq(users.isActive, true),
          role === 'GUEST' ? ne(users.role, 'GUEST') : undefined,
          query.trim() ? or(ilike(users.name, term), ilike(users.email, term)) : undefined,
        ),
      )
      .orderBy(asc(users.name))
      .limit(limit);
    return rows.map((row) => this.toSummary(row));
  }

  /** Abmelde-Link aus einer Benachrichtigung: schaltet die Mails ab. */
  async disableNotifications(userId: string): Promise<boolean> {
    const [row] = await this.db
      .update(users)
      .set({ notificationsEnabled: false, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return Boolean(row);
  }

  async findByIdOrFail(id: string): Promise<UserDto> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!row) throw new NotFoundException('Benutzer nicht gefunden.');
    return this.toDto(row);
  }

  async create(dto: CreateUserDto): Promise<UserDto> {
    const problem = validatePasswordStrength(dto.password, await this.authSettings.getPasswordPolicy());
    if (problem) throw new BadRequestException(problem);

    const email = normalizeEmail(dto.email);
    const [existing] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new ConflictException('Diese E-Mail-Adresse wird bereits verwendet.');

    const [row] = await this.db
      .insert(users)
      .values({
        email,
        name: normalizeName(dto.name),
        role: dto.role ?? 'MEMBER',
        passwordHash: await hashPassword(dto.password),
      })
      .returning();
    return this.toDto(row);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserDto> {
    const [existing] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!existing) throw new NotFoundException('Benutzer nicht gefunden.');

    if (dto.password) {
      const problem = validatePasswordStrength(
        dto.password,
        await this.authSettings.getPasswordPolicy(),
      );
      if (problem) throw new BadRequestException(problem);
    }

    // Ein Gast hat kein Passwort und kein Microsoft-365-Konto im Tenant – die
    // Logins von Team und Gast sind grundverschieden, ein Rollenwechsel in
    // diese Richtung ergibt also kein brauchbares Konto (Phase 21). Für einen
    // echten Kollegen entsteht ein neues, richtiges Konto unter „Benutzer“.
    if (existing.role === 'GUEST' && (dto.role === 'MEMBER' || dto.role === 'ADMIN')) {
      throw new BadRequestException(
        'Ein Gast lässt sich nicht ins Team aufnehmen – Gäste melden sich per Code an, das Team ' +
          'mit Passwort oder Microsoft 365. Für einen echten Kollegen bitte unter „Benutzer" ein ' +
          'eigenes Konto anlegen.',
      );
    }

    // Sonst kann sich der letzte Admin selbst aussperren und niemand kommt
    // mehr an die Einstellungen.
    const losesAdmin = existing.role === 'ADMIN' && (dto.role === 'MEMBER' || dto.role === 'GUEST');
    if (losesAdmin || (existing.role === 'ADMIN' && dto.isActive === false)) {
      await this.assertAnotherAdminRemains(id);
    }

    const [row] = await this.db
      .update(users)
      .set({
        name: dto.name === undefined ? undefined : normalizeName(dto.name),
        role: dto.role,
        isActive: dto.isActive,
        passwordHash: dto.password ? await hashPassword(dto.password) : undefined,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    return this.toDto(row);
  }

  async updateMe(id: string, dto: UpdateMeDto): Promise<UserDto> {
    const [row] = await this.db
      .update(users)
      .set({
        name: dto.name === undefined ? undefined : normalizeName(dto.name),
        notificationsEnabled: dto.notificationsEnabled,
        // Leerer String heißt „wie im Workspace" – das ist der Weg zurück
        // zur Vorgabe, ohne ein eigenes Löschen-Feld (Phase 26).
        locale: dto.locale === undefined ? undefined : dto.locale || null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();
    if (!row) throw new NotFoundException('Benutzer nicht gefunden.');
    return this.toDto(row);
  }

  private async assertAnotherAdminRemains(excludedId: string): Promise<void> {
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, 'ADMIN'), eq(users.isActive, true), ne(users.id, excludedId)));
    if (count < 1) {
      throw new BadRequestException(
        'Es muss mindestens ein aktiver Administrator übrig bleiben.',
      );
    }
  }
}
