import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  HLS_MODES,
  MAX_ENVIRONMENT_NOTES_LENGTH,
  MAX_PROJECT_FILE_DIGEST_MINUTES,
  NOTIFICATION_KINDS,
  PASSWORD_MIN_LENGTH_CEILING,
  PASSWORD_MIN_LENGTH_FLOOR,
  RENDITION_CONTAINERS,
  SMTP_AUTH_METHODS,
  TRANSCODE_TIMINGS,
  X264_PRESETS,
  type AboutDto,
  type AuthSettingsDto,
  type DownloadPresetDto,
  type MailFailureDto,
  type NotificationKind,
  type NotificationSettingsDto,
  type ProjectSettingsDto,
  type SmtpProviderPresetDto,
  type SmtpSettingsDto,
  type StorageStatusDto,
  type TranscodeSettingsDto,
  type VersionSettingsDto,
} from '@klappe/shared';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { LocaleService } from '../i18n/locale.service';
import { MailService } from '../mail/mail.service';
import { AuthSettingsService } from './auth-settings.service';
import { NotificationSettingsService } from './notification-settings.service';
import {
  MAX_ARCHIVE_RETENTION_DAYS,
  MAX_MAIL_DIGEST_MINUTES,
  SettingsService,
} from './settings.service';
import {
  MAX_BITRATE_KBPS,
  MAX_SHORT_EDGE,
  MIN_BITRATE_KBPS,
  MIN_SHORT_EDGE,
  TranscodeSettingsService,
} from './transcode-settings.service';
import { smtpPresets } from './smtp-presets';

class UpdateSmtpDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsBoolean()
  secure?: boolean;

  @IsOptional()
  @IsIn(SMTP_AUTH_METHODS)
  authMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  user?: string;

  /** Leer lassen heißt „unverändert“; ein leerer String löscht das Passwort. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  password?: string;

  /** Nur bei `oauth2`: Verzeichnis-ID (Tenant) der App-Registrierung. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  oauthTenantId?: string;

  /** Nur bei `oauth2`: Anwendungs-ID (Client) der App-Registrierung. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  oauthClientId?: string;

  /** Leer lassen heißt „unverändert“; ein leerer String löscht das Secret. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  oauthClientSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fromName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  fromEmail?: string;

  /** Ruhezeit vor der Sammelmail; `0` verschickt sofort (Phase 18). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MAIL_DIGEST_MINUTES)
  digestMinutes?: number;
}

/** Ein Schalterpaar für eine Mailart (Phase 28). */
class NotificationKindSwitchDto {
  @IsIn(NOTIFICATION_KINDS)
  kind!: NotificationKind;

  @IsOptional()
  @IsBoolean()
  team?: boolean;

  @IsOptional()
  @IsBoolean()
  guest?: boolean;
}

class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NotificationKindSwitchDto)
  kinds?: NotificationKindSwitchDto[];

  /** Ruhezeit für Kommentare; `0` schickt sofort und einzeln. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MAIL_DIGEST_MINUTES)
  digestMinutes?: number;

  /** Ruhezeit für Kundenmaterial – getrennt und höher. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PROJECT_FILE_DIGEST_MINUTES)
  projectFileDigestMinutes?: number;

  @IsOptional()
  @IsBoolean()
  mentionImmediate?: boolean;
}

/** Interne Fassungen (Phase 28) – die beiden Schalter. */
class UpdateVersionSettingsDto {
  @IsOptional()
  @IsBoolean()
  internalEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  internalByDefault?: boolean;
}

/** Projekte (Phase 20) – bis dahin hing das mit an den Mail-Einstellungen. */
class UpdateProjectSettingsDto {
  /** Aufbewahrung alter Fassungen archivierter Projekte, in Tagen. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ARCHIVE_RETENTION_DAYS)
  archiveRetentionDays?: number;
}

/** „Über diese Software" – der Umgebungshinweis. Ein leerer String löscht ihn. */
class UpdateAboutDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_ENVIRONMENT_NOTES_LENGTH)
  environmentNotes?: string;
}

/** Verarbeitung (Phase 19). Leere Zeichenketten löschen das Zeitfenster. */
class UpdateTranscodeDto {
  @IsOptional()
  @IsBoolean()
  downloadFormatsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  downloadFinalOnly?: boolean;

  @IsOptional()
  @IsIn(TRANSCODE_TIMINGS)
  downloadTiming?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  downloadWindowStart?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  downloadWindowEnd?: string;

  @IsOptional()
  @IsIn(HLS_MODES)
  hlsMode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  hlsWindowStart?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  hlsWindowEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(MIN_SHORT_EDGE)
  @Max(MAX_SHORT_EDGE)
  proxyShortEdge?: number;

  @IsOptional()
  @IsInt()
  @Min(MIN_BITRATE_KBPS)
  @Max(MAX_BITRATE_KBPS)
  proxyVideoBitrateKbps?: number;

  @IsOptional()
  @IsIn(X264_PRESETS)
  proxyPreset?: string;
}

class PresetDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsInt()
  @Min(MIN_SHORT_EDGE)
  @Max(MAX_SHORT_EDGE)
  shortEdge!: number;

  @IsInt()
  @Min(MIN_BITRATE_KBPS)
  @Max(MAX_BITRATE_KBPS)
  videoBitrateKbps!: number;

  @IsOptional()
  @IsInt()
  @Min(32)
  @Max(512)
  audioBitrateKbps?: number;

  @IsOptional()
  @IsIn(X264_PRESETS)
  preset?: string;

  @IsOptional()
  @IsIn(RENDITION_CONTAINERS)
  container?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class UpdatePresetDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(MIN_SHORT_EDGE)
  @Max(MAX_SHORT_EDGE)
  shortEdge?: number;

  @IsOptional()
  @IsInt()
  @Min(MIN_BITRATE_KBPS)
  @Max(MAX_BITRATE_KBPS)
  videoBitrateKbps?: number;

  @IsOptional()
  @IsInt()
  @Min(32)
  @Max(512)
  audioBitrateKbps?: number;

  @IsOptional()
  @IsIn(X264_PRESETS)
  preset?: string;

  @IsOptional()
  @IsIn(RENDITION_CONTAINERS)
  container?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class TestMailDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  to?: string;
}

class UpdateAuthDto {
  @IsOptional()
  @IsBoolean()
  localLoginEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  oidcEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tenantId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientId?: string;

  /** Leer lassen heißt „unverändert“; ein leerer String löscht das Secret. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  clientSecret?: string;

  @IsOptional()
  @IsBoolean()
  autoProvision?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  allowedDomains?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  buttonLabel?: string;

  /** Passwort-Richtlinie (Phase 24) – jedes Feld für sich änderbar. */
  @IsOptional()
  @IsInt()
  @Min(PASSWORD_MIN_LENGTH_FLOOR)
  @Max(PASSWORD_MIN_LENGTH_CEILING)
  passwordMinLength?: number;

  @IsOptional()
  @IsBoolean()
  passwordRequireLetter?: boolean;

  @IsOptional()
  @IsBoolean()
  passwordRequireDigit?: boolean;

  @IsOptional()
  @IsBoolean()
  passwordRequireMixedCase?: boolean;

  @IsOptional()
  @IsBoolean()
  passwordRequireSymbol?: boolean;
}

@Controller('v1/settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly mailService: MailService,
    private readonly authSettings: AuthSettingsService,
    private readonly transcodeSettings: TranscodeSettingsService,
    private readonly locales: LocaleService,
    private readonly notificationSettings: NotificationSettingsService,
  ) {}

  @Roles('ADMIN')
  @Get('smtp')
  getSmtp(): Promise<SmtpSettingsDto> {
    return this.settingsService.getSmtpSettings();
  }

  @Roles('ADMIN')
  @Put('smtp')
  updateSmtp(@Body() dto: UpdateSmtpDto): Promise<SmtpSettingsDto> {
    return this.settingsService.updateSmtp({
      enabled: dto.enabled,
      provider: dto.provider,
      host: dto.host,
      port: dto.port,
      secure: dto.secure,
      authMethod: dto.authMethod,
      user: dto.user,
      // Ein weggelassenes Feld lässt das gespeicherte Passwort bzw. Secret in Ruhe.
      password: dto.password === undefined ? undefined : dto.password || null,
      oauthTenantId: dto.oauthTenantId,
      oauthClientId: dto.oauthClientId,
      oauthClientSecret: dto.oauthClientSecret === undefined ? undefined : dto.oauthClientSecret || null,
      fromName: dto.fromName,
      fromEmail: dto.fromEmail,
      digestMinutes: dto.digestMinutes,
    });
  }

  /**
   * Benachrichtigungen (Phase 28) – welche Mail an welchen Empfängerkreis
   * hinausgeht, dazu die beiden Ruhezeiten. Nur Admin.
   */
  @Roles('ADMIN')
  @Get('benachrichtigungen')
  getNotificationSettings(): Promise<NotificationSettingsDto> {
    return this.notificationSettings.get();
  }

  @Roles('ADMIN')
  @Put('benachrichtigungen')
  updateNotificationSettings(
    @Body() dto: UpdateNotificationSettingsDto,
  ): Promise<NotificationSettingsDto> {
    return this.notificationSettings.update({
      kinds: dto.kinds,
      digestMinutes: dto.digestMinutes,
      projectFileDigestMinutes: dto.projectFileDigestMinutes,
      mentionImmediate: dto.mentionImmediate,
    });
  }

  /**
   * Interne Fassungen (Phase 28). **Lesbar fürs Team**, nicht nur für Admins:
   * Das Upload-Fenster muss wissen, ob es den Haken überhaupt anbietet und wie
   * er vorbelegt ist. Ändern darf weiterhin nur der Admin.
   */
  @Roles('ADMIN', 'MEMBER')
  @Get('fassungen')
  getVersionSettings(): Promise<VersionSettingsDto> {
    return this.settingsService.getVersionSettings();
  }

  @Roles('ADMIN')
  @Put('fassungen')
  updateVersionSettings(@Body() dto: UpdateVersionSettingsDto): Promise<VersionSettingsDto> {
    return this.settingsService.updateVersionSettings({
      internalEnabled: dto.internalEnabled,
      internalByDefault: dto.internalByDefault,
    });
  }

  @Roles('ADMIN')
  @Get('projects')
  getProjectSettings(): Promise<ProjectSettingsDto> {
    return this.settingsService.getProjectSettings();
  }

  @Roles('ADMIN')
  @Put('projects')
  updateProjectSettings(@Body() dto: UpdateProjectSettingsDto): Promise<ProjectSettingsDto> {
    return this.settingsService.updateProjectSettings({
      archiveRetentionDays: dto.archiveRetentionDays,
    });
  }

  /**
   * „Über diese Software" (Umgebungshinweis): lesbar für jeden Angemeldeten,
   * auch Gäste – anders als die übrige Verwaltung, die dem Team vorbehalten
   * bleibt.
   */
  @Get('about')
  getAbout(): Promise<AboutDto> {
    return this.settingsService.getAbout();
  }

  @Roles('ADMIN')
  @Put('about')
  updateAbout(@Body() dto: UpdateAboutDto): Promise<AboutDto> {
    return this.settingsService.updateAbout({
      environmentNotes: dto.environmentNotes === undefined ? undefined : dto.environmentNotes || null,
    });
  }

  /**
   * Wie voll die Ablage ist (Phase 22). Admin-Sache: Der Pfad verrät etwas
   * über den Aufbau der Anlage, und für Gäste wäre die Zahl ohnehin nur
   * Beunruhigung ohne Handhabe.
   */
  @Roles('ADMIN')
  @Get('storage')
  getStorage(): Promise<StorageStatusDto> {
    return this.settingsService.getStorageStatus();
  }

  /**
   * Name und Hinweis stehen in der Sprache des Admins (Phase 26) – die Liste
   * ist Anleitung, keine Konfiguration, und wird gelesen wie die Seite drumherum.
   */
  @Roles('ADMIN')
  @Get('smtp/presets')
  async presets(@CurrentUser() user: RequestUser): Promise<SmtpProviderPresetDto[]> {
    return smtpPresets(await this.locales.forUser(user.locale));
  }

  /** Schickt eine Testmail; Fehler des Mailservers kommen unverändert zurück. */
  @Roles('ADMIN')
  @Post('smtp/test')
  @HttpCode(204)
  async sendTest(@Body() dto: TestMailDto, @CurrentUser() user: RequestUser): Promise<void> {
    await this.mailService.sendTestMail(dto.to?.trim() || user.email, user.locale);
  }

  /**
   * Was nicht zugestellt werden konnte (Phase 18). Steht neben dem
   * Mailserver, der es nicht geschafft hat – dort sucht man danach.
   */
  @Roles('ADMIN')
  @Get('smtp/fehlversand')
  failures(): Promise<MailFailureDto[]> {
    return this.mailService.listFailures();
  }

  /** Abhaken – einzeln über `?id=`, ohne Angabe die ganze Liste. */
  @Roles('ADMIN')
  @Delete('smtp/fehlversand')
  @HttpCode(204)
  async clearFailures(@Query('id') id?: string): Promise<void> {
    await this.mailService.clearFailures(id);
  }

  /**
   * Ohne Anmeldung abfragbar: Die Gast-Anmeldung braucht die Auskunft, ob
   * überhaupt Codes verschickt werden können.
   */
  @Public()
  @Get('mail-status')
  async mailStatus(): Promise<{ ready: boolean }> {
    return { ready: await this.settingsService.isMailReady() };
  }

  // ---------- Anmeldung (Phase 11) ----------

  @Roles('ADMIN')
  @Get('auth')
  getAuth(): Promise<AuthSettingsDto> {
    return this.authSettings.get();
  }

  @Roles('ADMIN')
  @Put('auth')
  updateAuth(@Body() dto: UpdateAuthDto): Promise<AuthSettingsDto> {
    return this.authSettings.update({
      localLoginEnabled: dto.localLoginEnabled,
      oidcEnabled: dto.oidcEnabled,
      tenantId: dto.tenantId,
      clientId: dto.clientId,
      // Ein weggelassenes Feld lässt das gespeicherte Secret in Ruhe.
      clientSecret: dto.clientSecret === undefined ? undefined : dto.clientSecret || null,
      autoProvision: dto.autoProvision,
      allowedDomains: dto.allowedDomains,
      buttonLabel: dto.buttonLabel,
      passwordPolicy: {
        minLength: dto.passwordMinLength,
        requireLetter: dto.passwordRequireLetter,
        requireDigit: dto.passwordRequireDigit,
        requireMixedCase: dto.passwordRequireMixedCase,
        requireSymbol: dto.passwordRequireSymbol,
      },
    });
  }

  // ---------- Verarbeitung (Phase 19) ----------

  @Roles('ADMIN')
  @Get('transcode')
  getTranscode(): Promise<TranscodeSettingsDto> {
    return this.transcodeSettings.get();
  }

  @Roles('ADMIN')
  @Put('transcode')
  updateTranscode(@Body() dto: UpdateTranscodeDto): Promise<TranscodeSettingsDto> {
    return this.transcodeSettings.update({
      downloadFormatsEnabled: dto.downloadFormatsEnabled,
      downloadFinalOnly: dto.downloadFinalOnly,
      downloadTiming: dto.downloadTiming,
      downloadWindowStart: dto.downloadWindowStart,
      downloadWindowEnd: dto.downloadWindowEnd,
      hlsMode: dto.hlsMode,
      hlsWindowStart: dto.hlsWindowStart,
      hlsWindowEnd: dto.hlsWindowEnd,
      proxyShortEdge: dto.proxyShortEdge,
      proxyVideoBitrateKbps: dto.proxyVideoBitrateKbps,
      proxyPreset: dto.proxyPreset,
    });
  }

  @Roles('ADMIN')
  @Post('transcode/presets')
  createPreset(@Body() dto: PresetDto): Promise<DownloadPresetDto> {
    return this.transcodeSettings.createPreset(dto);
  }

  @Roles('ADMIN')
  @Patch('transcode/presets/:id')
  updatePreset(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePresetDto,
  ): Promise<DownloadPresetDto> {
    return this.transcodeSettings.updatePreset(id, dto);
  }

  /**
   * Löschen nimmt die schon erzeugten Dateien mit. Wer nur die Auswahl
   * loswerden will, schaltet das Format stattdessen aus.
   */
  @Roles('ADMIN')
  @Delete('transcode/presets/:id')
  @HttpCode(204)
  removePreset(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.transcodeSettings.removePreset(id);
  }
}
