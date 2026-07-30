import { Inject, Injectable } from '@nestjs/common';
import type { AboutDto, ProjectSettingsDto, SmtpSettingsDto } from '@klappe/shared';
import { normalizeEnvironmentNotes } from '@klappe/shared';
import { eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { type AppSettingsRow, appSettings } from '../db/schema';

/** SMTP AUTH mit Benutzername und Kennwort. */
export interface SmtpCredentialsPassword {
  authMethod: 'password';
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  password: string | null;
  fromName: string;
  fromEmail: string;
}

/**
 * Client-Credentials-Fluss gegen Entra ID. Nötig für Microsoft 365, sobald
 * der Tenant Mehrfaktor-Anmeldung erzwingt – dann lehnt der Server ein
 * Kennwort ab, auch ein App-Kennwort hilft nicht mehr.
 */
export interface SmtpCredentialsOAuth2 {
  authMethod: 'oauth2';
  host: string;
  port: number;
  secure: boolean;
  /** Das sendende Postfach, z. B. `versand@contoso.de`. */
  user: string;
  oauthTenantId: string;
  oauthClientId: string;
  oauthClientSecret: string;
  fromName: string;
  fromEmail: string;
}

/** Vollständige SMTP-Angaben inklusive Klartext-Geheimnissen – nur serverintern. */
export type SmtpCredentials = SmtpCredentialsPassword | SmtpCredentialsOAuth2;

export interface UpdateSmtpInput {
  enabled?: boolean;
  provider?: string | null;
  host?: string | null;
  port?: number | null;
  secure?: boolean;
  authMethod?: string;
  user?: string | null;
  /** `undefined` = unverändert, `null` = löschen, sonst neues Passwort. */
  password?: string | null;
  oauthTenantId?: string | null;
  oauthClientId?: string | null;
  /** `undefined` = unverändert, `null` = löschen, sonst neues Secret. */
  oauthClientSecret?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
  digestMinutes?: number;
}

const SETTINGS_ID = 1;

/**
 * Ruhezeit vor dem Versand (Phase 18). Fünf Minuten sind der Vorschlag: Wer
 * ein Video durchsieht, setzt seine Anmerkungen in kürzeren Abständen – die
 * landen also in einer Mail –, und wer beiläufig etwas nachträgt, wartet
 * nicht spürbar lange auf die Zustellung.
 */
export const DEFAULT_MAIL_DIGEST_MINUTES = 5;
/** Länger als zwei Stunden zu sammeln hilft niemandem mehr. */
export const MAX_MAIL_DIGEST_MINUTES = 120;

/**
 * Wie lange die alten Fassungen eines archivierten Projekts liegen bleiben
 * (Phase 18). 30 Tage: lang genug, um ein versehentliches Archivieren zu
 * bemerken, kurz genug, um Platz zu schaffen.
 */
export const DEFAULT_ARCHIVE_RETENTION_DAYS = 30;
/** Ein Jahr ist die Obergrenze – darüber ist es kein Archiv mehr, sondern Ablage. */
export const MAX_ARCHIVE_RETENTION_DAYS = 365;

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
      authMethod: row.smtpAuthMethod === 'oauth2' ? 'oauth2' : 'password',
      user: row.smtpUser,
      hasPassword: Boolean(row.smtpPasswordEncrypted),
      oauthTenantId: row.smtpOauthTenantId,
      oauthClientId: row.smtpOauthClientId,
      hasOauthClientSecret: Boolean(row.smtpOauthClientSecretEncrypted),
      fromName: row.smtpFromName,
      fromEmail: row.smtpFromEmail,
      digestMinutes: row.mailDigestMinutes,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Einstellungen rund um Projekte (Phase 20). Bis dahin hing die
   * Aufbewahrungsfrist an den Mail-Einstellungen – dieselbe Zeile in der
   * Datenbank, aber inhaltlich ohne Zusammenhang.
   */
  async getProjectSettings(): Promise<ProjectSettingsDto> {
    const row = await this.getRow();
    return {
      archiveRetentionDays: row.archiveRetentionDays,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async updateProjectSettings(input: {
    archiveRetentionDays?: number;
  }): Promise<ProjectSettingsDto> {
    await this.getRow();
    if (input.archiveRetentionDays !== undefined) {
      await this.db
        .update(appSettings)
        .set({
          archiveRetentionDays: Math.max(
            0,
            Math.min(MAX_ARCHIVE_RETENTION_DAYS, Math.round(input.archiveRetentionDays)),
          ),
          updatedAt: new Date(),
        })
        .where(eq(appSettings.id, SETTINGS_ID));
    }
    return this.getProjectSettings();
  }

  /**
   * „Über diese Software": der einzige Teil davon, der in der Datenbank
   * steht. Autor und Software selbst sind feste Angaben in der Oberfläche –
   * nur der Hinweis zur Umgebung ist von Anlage zu Anlage verschieden und
   * gehört deshalb hierher. Lesbar für jeden Angemeldeten, auch Gäste;
   * schreibbar nur für den Admin (siehe Controller).
   */
  async getAbout(): Promise<AboutDto> {
    const row = await this.getRow();
    return {
      environmentNotes: row.environmentNotes,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async updateAbout(input: { environmentNotes?: string | null }): Promise<AboutDto> {
    await this.getRow();
    if (input.environmentNotes !== undefined) {
      await this.db
        .update(appSettings)
        .set({
          environmentNotes: normalizeEnvironmentNotes(input.environmentNotes),
          updatedAt: new Date(),
        })
        .where(eq(appSettings.id, SETTINGS_ID));
    }
    return this.getAbout();
  }

  /**
   * Ruhezeit in Minuten. `0` heißt: sofort verschicken. Ein unsinniger Wert
   * in der Datenbank fällt auf den Standard zurück, statt den Versand
   * lahmzulegen.
   */
  /** Aufbewahrungsfrist für alte Fassungen archivierter Projekte, in Tagen. */
  async archiveRetentionDays(): Promise<number> {
    const row = await this.getRow();
    const tage = row.archiveRetentionDays;
    if (!Number.isFinite(tage) || tage < 0) return DEFAULT_ARCHIVE_RETENTION_DAYS;
    return Math.min(tage, MAX_ARCHIVE_RETENTION_DAYS);
  }

  async digestMinutes(): Promise<number> {
    const row = await this.getRow();
    const minutes = row.mailDigestMinutes;
    if (!Number.isFinite(minutes) || minutes < 0) return DEFAULT_MAIL_DIGEST_MINUTES;
    return Math.min(minutes, MAX_MAIL_DIGEST_MINUTES);
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
        smtpAuthMethod: input.authMethod === undefined ? undefined : input.authMethod,
        smtpUser: input.user === undefined ? undefined : input.user?.trim() || null,
        smtpPasswordEncrypted:
          input.password === undefined
            ? undefined
            : input.password
              ? encryptSecret(input.password, this.config.jwt.secret)
              : null,
        smtpOauthTenantId:
          input.oauthTenantId === undefined ? undefined : input.oauthTenantId?.trim() || null,
        smtpOauthClientId:
          input.oauthClientId === undefined ? undefined : input.oauthClientId?.trim() || null,
        smtpOauthClientSecretEncrypted:
          input.oauthClientSecret === undefined
            ? undefined
            : input.oauthClientSecret
              ? encryptSecret(input.oauthClientSecret, this.config.jwt.secret)
              : null,
        smtpFromName: input.fromName === undefined ? undefined : input.fromName?.trim() || null,
        smtpFromEmail:
          input.fromEmail === undefined ? undefined : input.fromEmail?.trim().toLowerCase() || null,
        mailDigestMinutes:
          input.digestMinutes === undefined
            ? undefined
            : Math.max(0, Math.min(MAX_MAIL_DIGEST_MINUTES, Math.round(input.digestMinutes))),
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

    const fromName = row.smtpFromName?.trim() || 'Klappe';
    const fromEmail = row.smtpFromEmail;

    if (row.smtpAuthMethod === 'oauth2') {
      if (!row.smtpUser || !row.smtpOauthTenantId || !row.smtpOauthClientId) return null;
      const clientSecret = decryptSecret(row.smtpOauthClientSecretEncrypted, this.config.jwt.secret);
      if (!clientSecret) return null;

      return {
        authMethod: 'oauth2',
        host: row.smtpHost,
        port: row.smtpPort,
        secure: row.smtpSecure,
        user: row.smtpUser,
        oauthTenantId: row.smtpOauthTenantId,
        oauthClientId: row.smtpOauthClientId,
        oauthClientSecret: clientSecret,
        fromName,
        fromEmail,
      };
    }

    return {
      authMethod: 'password',
      host: row.smtpHost,
      port: row.smtpPort,
      secure: row.smtpSecure,
      user: row.smtpUser,
      password: decryptSecret(row.smtpPasswordEncrypted, this.config.jwt.secret),
      fromName,
      fromEmail,
    };
  }

  /** Kann der Server gerade Mails verschicken? */
  async isMailReady(): Promise<boolean> {
    return (await this.getCredentials()) !== null;
  }
}
