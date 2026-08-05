import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { users } from '../db/schema';
import { normalizeEmail } from '../common/normalize';
import { AuthSettingsService } from '../settings/auth-settings.service';
import { hashPassword, validatePasswordStrength, verifyPassword } from './password';
import type { JwtPayload, RequestUser } from './auth.types';
import type { UserRow } from '../db/schema';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly jwtService: JwtService,
    /* Für die Passwort-Richtlinie des Workspace (Phase 24). */
    private readonly authSettings: AuthSettingsService,
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

    /*
     * Bis Phase 24 prüfte hier nur der Formularwächter die Länge – Buchstaben
     * und Ziffern verlangte er nicht. Wer sein Passwort selbst änderte, kam
     * also an Regeln vorbei, die beim Anlegen eines Kontos galten.
     */
    const problem = validatePasswordStrength(
      newPassword,
      await this.authSettings.getPasswordPolicy(),
    );
    if (problem) throw new BadRequestException(problem);
    await this.db
      .update(users)
      .set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    this.logger.log(`Passwort geändert für ${row.email}`);
  }

  /**
   * Den ersten Admin im Browser anlegen (1.5.1).
   *
   * Der Weg für eine frische Anlage: Wer Klappe zum ersten Mal öffnet, legt
   * sein Konto selbst an, statt Zugangsdaten in die `.env` zu schreiben. Ein
   * Passwort in einer Datei bleibt dort stehen – im Klartext, in jeder
   * Sicherung, und meist unverändert.
   *
   * Die Route ist öffentlich und **genau einmal** benutzbar: Sobald irgendein
   * Konto existiert, wird sie abgewiesen. Das ist die ganze Absicherung, und
   * sie genügt, weil das Zeitfenster zwischen erstem Start und erstem Konto
   * ohnehin dem gehört, der den Container gestartet hat.
   */
  async setupFirstAdmin(input: {
    email: string;
    name: string;
    password: string;
  }): Promise<void> {
    if (!(await this.authSettings.isFreshInstall())) {
      throw new ForbiddenException(
        'Es gibt bereits Konten – die Ersteinrichtung ist abgeschlossen.',
      );
    }

    const policy = await this.authSettings.getPasswordPolicy();
    const verstoss = validatePasswordStrength(input.password, policy);
    if (verstoss) throw new BadRequestException(verstoss);

    const email = input.email.trim().toLowerCase();
    const [angelegt] = await this.db
      .insert(users)
      .values({
        email,
        name: input.name.trim() || email,
        role: 'ADMIN',
        nameConfirmed: true,
        passwordHash: await hashPassword(input.password),
      })
      // Zwei gleichzeitige Einrichtungen: Der Zweite läuft ins Leere statt in
      // einen Datenbankfehler – geprüft wird gleich danach.
      .onConflictDoNothing()
      .returning();

    if (!angelegt) {
      throw new ForbiddenException('Die Ersteinrichtung ist bereits erfolgt.');
    }
    this.logger.log(`Ersteinrichtung: Admin ${email} angelegt.`);
  }

  /**
   * Legt beim ersten Start den Admin aus `ADMIN_EMAIL`/`ADMIN_PASSWORD` an.
   *
   * Seit 1.5.1 der **Nebenweg**: Normalerweise entsteht der erste Admin im
   * Browser (siehe `setupFirstAdmin`). Wer die beiden Variablen dennoch
   * setzt, bekommt weiter sein Startkonto – für automatisierte Aufbauten, die
   * keinen Menschen am Browser haben.
   */
  async ensureBootstrapAdmin(): Promise<void> {
    const { email, password, name } = this.config.bootstrapAdmin;
    if (!email || !password) {
      this.logger.log(
        'Kein ADMIN_EMAIL/ADMIN_PASSWORD gesetzt – der erste Admin wird im Browser angelegt.',
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
