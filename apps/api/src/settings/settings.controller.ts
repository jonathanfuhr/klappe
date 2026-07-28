import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import type { SmtpProviderPresetDto, SmtpSettingsDto } from '@klappe/shared';
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
import { SettingsService } from './settings.service';
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
}

class TestMailDto {
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  to?: string;
}

@Controller('v1/settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly mailService: MailService,
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
   * Ohne Anmeldung abfragbar: Die Gast-Anmeldung braucht die Auskunft, ob
   * überhaupt Codes verschickt werden können.
   */
  @Public()
  @Get('mail-status')
  async mailStatus(): Promise<{ ready: boolean }> {
    return { ready: await this.settingsService.isMailReady() };
  }
}
