import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { users } from '../db/schema';
import { normalizeEmail } from '../common/normalize';
import { hashPassword, verifyPassword } from './password';
import type { JwtPayload, RequestUser } from './auth.types';
import type { UserRow } from '../db/schema';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Prüft E-Mail und Passwort. Unbekannte Adresse und falsches Passwort
   * ergeben bewusst dieselbe Meldung, damit sich vorhandene Konten nicht
   * abfragen lassen.
   */
  async validateLogin(email: string, password: string): Promise<UserRow> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, normalizeEmail(email)))
      .limit(1);

    const passwordOk = await verifyPassword(password, user?.passwordHash ?? null);
    if (!user || !passwordOk || !user.isActive) {
      throw new UnauthorizedException('E-Mail-Adresse oder Passwort ist falsch.');
    }

    await this.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    return user;
  }

  async issueToken(user: Pick<UserRow, 'id' | 'email' | 'role'>): Promise<string> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    return this.jwtService.signAsync(payload, {
      secret: this.config.jwt.secret,
      expiresIn: this.config.jwt.ttlSeconds,
    });
  }

  async changePassword(user: RequestUser, currentPassword: string, newPassword: string): Promise<void> {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!row || !(await verifyPassword(currentPassword, row.passwordHash))) {
      throw new UnauthorizedException('Das aktuelle Passwort ist falsch.');
    }
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    this.logger.log(`Passwort geändert für ${row.email}`);
  }

  /**
   * Legt beim ersten Start den Admin aus `ADMIN_EMAIL`/`ADMIN_PASSWORD` an.
   * Existiert das Konto schon, passiert nichts – das Passwort wird also nicht
   * bei jedem Neustart zurückgesetzt.
   */
  async ensureBootstrapAdmin(): Promise<void> {
    const { email, password, name } = this.config.bootstrapAdmin;
    if (!email || !password) {
      this.logger.warn(
        'ADMIN_EMAIL/ADMIN_PASSWORD sind nicht gesetzt – es wird kein Startkonto angelegt.',
      );
      return;
    }

    const [existing] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing) return;

    await this.db.insert(users).values({
      email,
      name,
      role: 'ADMIN',
      passwordHash: await hashPassword(password),
    });
    this.logger.log(`Startkonto angelegt: ${email}`);
  }
}
