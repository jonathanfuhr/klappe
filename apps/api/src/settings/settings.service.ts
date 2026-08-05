import { Inject, Injectable } from '@nestjs/common';
import type {
  AboutDto,
  ProjectSettingsDto,
  SmtpSettingsDto,
  StorageStatusDto,
  VersionSettingsDto,
} from '@klappe/shared';
import { normalizeEnvironmentNotes } from '@klappe/shared';
import { eq, sql } from 'drizzle-orm';
import { buildInfo } from '../common/build-info';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import {
  type AppSettingsRow,
  appSettings,
  projectFiles,
  uploads,
  versionRenditions,
  videoVersions,
} from '../db/schema';
import { StorageService } from '../storage/storage.service';

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

/** Die eine Einstellungszeile. Auch das Push-Modul schreibt dort hinein. */
export const SETTINGS_ID = 1;

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
    private readonly storage: StorageService,
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
   * Interne Fassungen (Phase 28). Zwei Schalter, die zusammengehören: ob es
   * die Funktion überhaupt gibt und ob sie ab Werk greift.
   */
  async getVersionSettings(): Promise<VersionSettingsDto> {
    const row = await this.getRow();
    return {
      internalEnabled: row.internalVersionsEnabled,
      internalByDefault: row.internalVersionsDefault,
    };
  }

  async updateVersionSettings(input: {
    internalEnabled?: boolean;
    internalByDefault?: boolean;
  }): Promise<VersionSettingsDto> {
    await this.getRow();
    await this.db
      .update(appSettings)
      .set({
        internalVersionsEnabled: input.internalEnabled,
        internalVersionsDefault: input.internalByDefault,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));
    return this.getVersionSettings();
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
   * Wie voll die Ablage ist (Phase 22).
   *
   * Zwei Herkünfte, bewusst getrennt: Der freie Platz kommt vom Dateisystem
   * (siehe `StorageService.freeSpace`) und gilt für alles, was dort liegt –
   * auf einer NAS teilt sich Klappe den Platz oft mit anderem. Was Klappe
   * selbst belegt, wird aus der Datenbank summiert.
   *
   * Die Summen laufen über `double precision`, nicht über `int`: Ein `sum`
   * über `bigint` sprengt in Postgres die 2-GB-Grenze von `int4` sofort, und
   * `numeric` käme als Zeichenkette zurück. Ein Double trägt ganze Zahlen bis
   * 2^53 exakt – gut neun Petabyte.
   */
  async getStorageStatus(): Promise<StorageStatusDto> {
    const [fassungen] = await this.db
      .select({
        originals: sql<number>`coalesce(sum(${videoVersions.originalSizeBytes}), 0)::double precision`,
        proxies: sql<number>`coalesce(sum(${videoVersions.proxySizeBytes}), 0)::double precision`,
      })
      .from(videoVersions);

    const [formate] = await this.db
      .select({
        bytes: sql<number>`coalesce(sum(${versionRenditions.sizeBytes}), 0)::double precision`,
      })
      .from(versionRenditions);

    const [kundendateien] = await this.db
      .select({
        bytes: sql<number>`coalesce(sum(${projectFiles.sizeBytes}), 0)::double precision`,
      })
      .from(projectFiles);

    // Angefangene Uploads liegen im Zwischenspeicher – gezählt wird, was
    // wirklich schon geschrieben ist, nicht die angekündigte Endgröße.
    const [angefangen] = await this.db
      .select({
        bytes: sql<number>`coalesce(sum(${uploads.offsetBytes}), 0)::double precision`,
      })
      .from(uploads)
      .where(eq(uploads.status, 'IN_PROGRESS'));

    const usage = {
      originals: fassungen?.originals ?? 0,
      proxies: fassungen?.proxies ?? 0,
      renditions: formate?.bytes ?? 0,
      projectFiles: kundendateien?.bytes ?? 0,
      uploads: angefangen?.bytes ?? 0,
      total: 0,
    };
    usage.total =
      usage.originals + usage.proxies + usage.renditions + usage.projectFiles + usage.uploads;

    const platz = await this.storage.freeSpace();
    return {
      path: platz?.path ?? this.config.storage.root,
      // Eine Durchreiche liefert zwar Zahlen, aber die falschen – sie zählt
      // hier wie „keine Auskunft", nur mit einer besseren Begründung.
      available: platz !== null && platz.totalBytes !== null,
      passthroughFs: platz?.passthroughFs ?? null,
      totalBytes: platz?.totalBytes ?? null,
      freeBytes: platz?.freeBytes ?? null,
      usedBytes: platz?.usedBytes ?? null,
      usage,
    };
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
      build: buildInfo(),
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
