import { Body, Controller, Delete, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import type {
  AuthSettingsDto,
  MailFailureDto,
  SmtpProviderPresetDto,
  SmtpSettingsDto,
} from '@klappe/shared';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { MailService } from '../mail/mail.service';
import { AuthSettingsService } from './auth-settings.service';
import {
  MAX_ARCHIVE_RETENTION_DAYS,
  MAX_MAIL_DIGEST_MINUTES,
  SettingsService,
} from './settings.service';
import { SMTP_PRESETS } from './smtp-presets';

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
  @IsString()
  @MaxLength(320)
  user?: string;

  /** Leer lassen heißt „unverändert“; ein leerer String löscht das Passwort. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  password?: string;

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

  /** Aufbewahrung alter Fassungen archivierter Projekte, in Tagen (Phase 18). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_ARCHIVE_RETENTION_DAYS)
  archiveRetentionDays?: number;
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
}

@Controller('v1/settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly mailService: MailService,
    private readonly authSettings: AuthSettingsService,
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
      user: dto.user,
      // Ein weggelassenes Feld lässt das gespeicherte Passwort in Ruhe.
      password: dto.password === undefined ? undefined : dto.password || null,
      fromName: dto.fromName,
      fromEmail: dto.fromEmail,
      digestMinutes: dto.digestMinutes,
      archiveRetentionDays: dto.archiveRetentionDays,
    });
  }

  @Roles('ADMIN')
  @Get('smtp/presets')
  presets(): SmtpProviderPresetDto[] {
    return SMTP_PRESETS;
  }

  /** Schickt eine Testmail; Fehler des Mailservers kommen unverändert zurück. */
  @Roles('ADMIN')
  @Post('smtp/test')
  @HttpCode(204)
  async sendTest(@Body() dto: TestMailDto, @CurrentUser() user: RequestUser): Promise<void> {
    await this.mailService.sendTestMail(dto.to?.trim() || user.email);
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
    });
  }
}
