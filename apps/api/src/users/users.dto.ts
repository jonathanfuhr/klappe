import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { LOCALES, PASSWORD_MAX_LENGTH, USER_ROLES, type UserRole } from '@klappe/shared';

export class CreateUserDto {
  @IsEmail({}, { message: 'Bitte eine gültige E-Mail-Adresse angeben.' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(2, { message: 'Bitte einen Namen angeben.' })
  @MaxLength(200)
  name!: string;

  /* Länge und Zusammensetzung prüft die Richtlinie im Dienst (Phase 24). */
  @IsString()
  @MinLength(1, { message: 'Bitte ein Passwort angeben.' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  password!: string;

  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRole;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIn(USER_ROLES)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password?: string;
}

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;

  /**
   * Eigene Sprache (Phase 26). Leerer String heißt „wie im Workspace" – so
   * kommt man ohne eigenen Knopf zur Vorgabe zurück.
   */
  @IsOptional()
  @IsIn([...LOCALES, ''])
  locale?: string;
}
