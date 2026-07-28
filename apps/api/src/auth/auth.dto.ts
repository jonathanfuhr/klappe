import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { MIN_PASSWORD_LENGTH } from './password';

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

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`,
  })
  @MaxLength(512)
  newPassword!: string;
}
