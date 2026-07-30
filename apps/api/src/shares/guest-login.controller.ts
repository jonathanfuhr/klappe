import { Body, Controller, HttpCode, Inject, Post, Res } from '@nestjs/common';
import type { UserDto } from '@klappe/shared';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { Public } from '../auth/auth.decorators';
import { RateLimit } from '../common/rate-limit.guard';
import { AppConfig, CONFIG } from '../config/configuration';
import { UsersService } from '../users/users.service';
import { SharesService } from './shares.service';

class GuestLoginCodeDto {
  @IsEmail({}, { message: 'Bitte eine gültige E-Mail-Adresse angeben.' })
  @MaxLength(320)
  email!: string;
}

class GuestLoginVerifyDto {
  @IsEmail({}, { message: 'Bitte eine gültige E-Mail-Adresse angeben.' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(10)
  code!: string;
}

/**
 * Gastzugang von der Anmeldeseite aus (Phase 20) – ohne Freigabe-Link.
 *
 * Für den Kunden, der die Mail mit dem Link nicht mehr findet: Adresse
 * eingeben, Code aus der Mail, drin. Was er dann sieht, richtet sich wie
 * immer nach seinen Freigaben.
 *
 * **Keine Selbstregistrierung:** Für eine Adresse, zu der es keinen
 * Gastzugang gibt, geht keine Mail raus – die Absage steht im Browser. Sonst
 * könnte sich jeder eintragen und bekäme Post von dieser Anlage.
 */
@Controller('v1/auth/gast')
export class GuestLoginController {
  constructor(
    private readonly sharesService: SharesService,
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  // Enger gefasst als der Weg über den Link: Dort hat der Anfragende immerhin
  // einen gültigen Token in der Hand, hier nur eine Adresse.
  @Public()
  @RateLimit({ name: 'gast-login-code', limit: 8, windowMs: 60 * 60 * 1000 })
  @Post('code')
  @HttpCode(204)
  async requestCode(@Body() dto: GuestLoginCodeDto): Promise<void> {
    await this.sharesService.requestGuestLoginCode(dto.email);
  }

  @Public()
  @RateLimit({ name: 'gast-login-verify', limit: 20, windowMs: 60 * 60 * 1000, identityField: 'email' })
  @Post('verify')
  @HttpCode(200)
  async verify(
    @Body() dto: GuestLoginVerifyDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: UserDto; redirectPath: string }> {
    const result = await this.sharesService.verifyGuestLogin({
      email: dto.email,
      code: dto.code,
    });

    response.cookie(this.config.jwt.cookieName, await this.authService.issueToken(result.user), {
      httpOnly: true,
      secure: this.config.jwt.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: this.config.jwt.ttlSeconds * 1000,
    });

    return { user: this.usersService.toDto(result.user), redirectPath: result.redirectPath };
  }
}
