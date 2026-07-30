import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SHARE_SCOPES, type ShareScope } from '@klappe/shared';

export class CreateShareLinkDto {
  @IsIn(SHARE_SCOPES)
  scope!: ShareScope;

  @IsOptional()
  @IsUUID('4')
  projectId?: string;

  @IsOptional()
  @IsUUID('4')
  videoId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @IsBoolean()
  allowDownload?: boolean;

  @IsOptional()
  @IsBoolean()
  allowUpload?: boolean;

  @IsOptional()
  @IsBoolean()
  allowComments?: boolean;

  /** Einbetten auf fremden Seiten – ohne Anmeldung, ohne Code, ohne Cookie. */
  @IsOptional()
  @IsBoolean()
  embedEnabled?: boolean;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class UpdateShareLinkDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @IsBoolean()
  allowDownload?: boolean;

  @IsOptional()
  @IsBoolean()
  allowUpload?: boolean;

  @IsOptional()
  @IsBoolean()
  allowComments?: boolean;

  @IsOptional()
  @IsBoolean()
  embedEnabled?: boolean;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  /** `true` zieht den Link zurück, `false` gibt ihn wieder frei. */
  @IsOptional()
  @IsBoolean()
  revoked?: boolean;
}

/**
 * Seit Phase 20 nur noch die Adresse: Der Name wird einmal beim ersten
 * Anmelden erfragt, nicht bei jedem Besuch.
 */
export class RequestGuestCodeDto {
  @IsEmail({}, { message: 'Bitte eine gültige E-Mail-Adresse angeben.' })
  @MaxLength(320)
  email!: string;
}

/** Der Name, den der Gast beim ersten Anmelden angibt (Phase 20). */
export class ConfirmGuestNameDto {
  @IsString()
  @MinLength(2, { message: 'Bitte den Namen angeben.' })
  @MaxLength(200)
  name!: string;
}

export class VerifyGuestCodeDto {
  @IsEmail({}, { message: 'Bitte eine gültige E-Mail-Adresse angeben.' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(10)
  code!: string;
}
