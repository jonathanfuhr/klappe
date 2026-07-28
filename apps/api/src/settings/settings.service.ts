import { Inject, Injectable } from '@nestjs/common';
import type { SmtpSettingsDto } from '@klappe/shared';
import { eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { type AppSettingsRow, appSettings } from '../db/schema';

/** Vollständige SMTP-Angaben inklusive Klartext-Passwort – nur serverintern. */
export interface SmtpCredentials {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  fromName: string;
  fromEmail: string;
}

export interface UpdateSmtpInput {
  enabled?: boolean;
  provider?: string | null;
  host?: string | null;
  port?: number | null;
  secure?: boolean;
  user?: string | null;
  /** `undefined` = unverändert, `null` = löschen, sonst neues Passwort. */
  password?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
}

const SETTINGS_ID = 1;

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Liefert die eine Einstellungszeile und legt sie beim ersten Mal an. */
  async getRow(): Promise<AppSettingsRow> {
    const [existing] = await this.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, SETTINGS_ID))
      .limit(1);
    if (existing) return existing;

    const [created] = await this.db
      .insert(appSettings)
      .values({ id: SETTINGS_ID })
      .onConflictDoNothing()
      .returning();
    if (created) return created;

    // Zwei gleichzeitige erste Aufrufe: Der Verlierer liest einfach nach.
    const [row] = await this.db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, SETTINGS_ID))
      .limit(1);
    return row;
  }

  async getSmtpSettings(): Promise<SmtpSettingsDto> {
    const row = await this.getRow();
    return {
      enabled: row.smtpEnabled,
      provider: row.smtpProvider,
      host: row.smtpHost,
      port: row.smtpPort,
      secure: row.smtpSecure,
      user: row.smtpUser,
      hasPassword: Boolean(row.smtpPasswordEncrypted),
      fromName: row.smtpFromName,
      fromEmail: row.smtpFromEmail,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async updateSmtp(input: UpdateSmtpInput): Promise<SmtpSettingsDto> {
    await this.getRow();

    await this.db
      .update(appSettings)
      .set({
        smtpEnabled: input.enabled,
        smtpProvider: input.provider === undefined ? undefined : input.provider,
        smtpHost: input.host === undefined ? undefined : input.host?.trim() || null,
        smtpPort: input.port === undefined ? undefined : input.port,
        smtpSecure: input.secure,
        smtpUser: input.user === undefined ? undefined : input.user?.trim() || null,
        smtpPasswordEncrypted:
          input.password === undefined
            ? undefined
            : input.password
              ? encryptSecret(input.password, this.config.jwt.secret)
              : null,
        smtpFromName: input.fromName === undefined ? undefined : input.fromName?.trim() || null,
        smtpFromEmail:
          input.fromEmail === undefined ? undefined : input.fromEmail?.trim().toLowerCase() || null,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));

    return this.getSmtpSettings();
  }

  /**
   * Zugangsdaten für den Versand. `null` bedeutet: nicht (vollständig)
   * eingerichtet – der Aufrufer entscheidet dann, ob er das als Fehler
   * meldet oder still übergeht.
   */
  async getCredentials(): Promise<SmtpCredentials | null> {
    const row = await this.getRow();
    if (!row.smtpEnabled) return null;
    if (!row.smtpHost || !row.smtpPort || !row.smtpFromEmail) return null;

    return {
      host: row.smtpHost,
      port: row.smtpPort,
      secure: row.smtpSecure,
      user: row.smtpUser,
      password: decryptSecret(row.smtpPasswordEncrypted, this.config.jwt.secret),
      fromName: row.smtpFromName?.trim() || 'Klappe',
      fromEmail: row.smtpFromEmail,
    };
  }

  /** Kann der Server gerade Mails verschicken? */
  async isMailReady(): Promise<boolean> {
    return (await this.getCredentials()) !== null;
  }
}
