import { Body, Controller, Get, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import type { GuestLoginResponseDto, SharePreviewDto } from '@klappe/shared';
import type { Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { Public } from '../auth/auth.decorators';
import { RateLimit } from '../common/rate-limit.guard';
import { AppConfig, CONFIG } from '../config/configuration';
import { UsersService } from '../users/users.service';
import { RequestGuestCodeDto, VerifyGuestCodeDto } from './shares.dto';
import { SharesService } from './shares.service';

/**
 * Der Weg des Gastes: Link öffnen → Name und E-Mail → Code aus der Mail →
 * angemeldet. Alle Routen hier sind bewusst offen, denn der Gast hat vorher
 * naturgemäß keine Sitzung. Der Token in der URL ist der Zugangsschutz.
 */
@Public()
@Controller('v1/share/:token')
export class GuestAccessController {
  constructor(
    private readonly sharesService: SharesService,
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  preview(@Param('token') token: string): Promise<SharePreviewDto> {
    return this.sharesService.preview(token);
  }

  // Der Dienst deckelt schon fünf Codes je Adresse und Stunde; diese Bremse
  // greift eine Ebene davor und schützt auch gegen wechselnde Adressen von
  // derselben Herkunft.
  @RateLimit({ name: 'guest-code', limit: 12, windowMs: 60 * 60 * 1000 })
  @Post('code')
  @HttpCode(204)
  async requestCode(
    @Param('token') token: string,
    @Body() dto: RequestGuestCodeDto,
  ): Promise<void> {
    await this.sharesService.requestCode(token, { name: dto.name, email: dto.email });
  }

  @RateLimit({ name: 'guest-verify', limit: 20, windowMs: 60 * 60 * 1000, identityField: 'email' })
  @Post('verify')
  @HttpCode(200)
  async verify(
    @Param('token') token: string,
    @Body() dto: VerifyGuestCodeDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<GuestLoginResponseDto> {
    const result = await this.sharesService.verifyCode(token, {
      email: dto.email,
      code: dto.code,
    });

    const sessionToken = await this.authService.issueToken(result.user);
    response.cookie(this.config.jwt.cookieName, sessionToken, {
      httpOnly: true,
      secure: this.config.jwt.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: this.config.jwt.ttlSeconds * 1000,
    });

    return {
      user: this.usersService.toDto(result.user),
      share: await this.sharesService.preview(token),
      redirectPath: result.redirectPath,
    };
  }
}
