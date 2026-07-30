import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { USER_ROLES, type UserRole } from '@klappe/shared';
import { MIN_PASSWORD_LENGTH } from '../auth/password';

export class CreateUserDto {
  @IsEmail({}, { message: 'Bitte eine gültige E-Mail-Adresse angeben.' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(2, { message: 'Bitte einen Namen angeben.' })
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`,
  })
  @MaxLength(512)
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
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(512)
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
}
