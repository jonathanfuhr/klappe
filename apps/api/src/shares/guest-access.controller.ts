import { Body, Controller, Get, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import type { GuestLoginResponseDto, SharePreviewDto, UserDto } from '@klappe/shared';
import type { Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { RateLimit } from '../common/rate-limit.guard';
import { AppConfig, CONFIG } from '../config/configuration';
import { UsersService } from '../users/users.service';
import { ConfirmGuestNameDto, RequestGuestCodeDto, VerifyGuestCodeDto } from './shares.dto';
import { SharesService } from './shares.service';

/**
 * Der Weg des Gastes (seit Phase 20): Link öffnen → E-Mail → Code aus der
 * Mail → beim allerersten Mal noch der Name → angemeldet. Wer schon eine
 * gültige Sitzung hat, geht über `weiter` direkt durch.
 *
 * Vorher stand bei *jedem* Besuch die volle Maske da, Name inklusive. Für
 * einen Kunden, der zum zwanzigsten Mal auf denselben Link klickt, war das
 * eine Zumutung.
 *
 * `@Public()` steht bewusst an den einzelnen Wegen und nicht an der Klasse:
 * Sonst stünden auch `weiter` und `name` offen, die ausdrücklich eine Sitzung
 * verlangen.
 */
@Controller('v1/share/:token')
export class GuestAccessController {
  constructor(
    private readonly sharesService: SharesService,
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  preview(@Param('token') token: string): Promise<SharePreviewDto> {
    return this.sharesService.preview(token);
  }

  // Der Dienst deckelt schon fünf Codes je Adresse und Stunde; diese Bremse
  // greift eine Ebene davor und schützt auch gegen wechselnde Adressen von
  // derselben Herkunft.
  @Public()
  @RateLimit({ name: 'guest-code', limit: 12, windowMs: 60 * 60 * 1000 })
  @Post('code')
  @HttpCode(204)
  async requestCode(
    @Param('token') token: string,
    @Body() dto: RequestGuestCodeDto,
  ): Promise<void> {
    await this.sharesService.requestCode(token, { email: dto.email });
  }

  @Public()
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

    this.setzeSitzung(response, await this.authService.issueToken(result.user));

    return {
      user: this.usersService.toDto(result.user),
      share: await this.sharesService.preview(token),
      redirectPath: result.redirectPath,
      needsName: result.needsName,
    };
  }

  /**
   * Schon angemeldet? Dann direkt weiter, ohne Adresse und ohne Code.
   *
   * Ohne Sitzung antwortet der Wächter mit 401, und die Oberfläche zeigt wie
   * gewohnt die Maske – das ist der gewollte Rückfall, kein Fehler.
   */
  @Roles('ADMIN', 'MEMBER', 'GUEST')
  @Post('weiter')
  @HttpCode(200)
  continue(
    @Param('token') token: string,
    @CurrentUser() user: RequestUser,
  ): Promise<{ redirectPath: string }> {
    return this.sharesService.continueWithSession(token, user);
  }

  /**
   * Den Namen einmalig festlegen. Braucht die frische Sitzung aus `verify`:
   * Wer den Code eingelöst hat, ist angemeldet, sagt aber noch nicht, wie er
   * heißt.
   */
  @Roles('ADMIN', 'MEMBER', 'GUEST')
  @Post('name')
  @HttpCode(200)
  async setName(
    @Body() dto: ConfirmGuestNameDto,
    @CurrentUser() user: RequestUser,
  ): Promise<UserDto> {
    return this.usersService.toDto(await this.sharesService.confirmName(user.id, dto.name));
  }

  private setzeSitzung(response: Response, token: string): void {
    response.cookie(this.config.jwt.cookieName, token, {
      httpOnly: true,
      secure: this.config.jwt.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: this.config.jwt.ttlSeconds * 1000,
    });
  }
}
