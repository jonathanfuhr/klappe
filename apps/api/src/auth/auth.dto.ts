import { PASSWORD_MAX_LENGTH } from '@klappe/shared';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Bitte eine gültige E-Mail-Adresse angeben.' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Bitte das Passwort angeben.' })
  @MaxLength(512)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(512)
  currentPassword!: string;

  /*
   * Nur „nicht leer" – die Länge gibt seit Phase 24 die Richtlinie des
   * Workspace vor, und die kennt erst der Dienst. Eine feste Zahl hier würde
   * eine niedriger eingestellte Richtlinie stillschweigend aushebeln.
   */
  @IsString()
  @MinLength(1, { message: 'Bitte ein neues Passwort angeben.' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword!: string;
}
