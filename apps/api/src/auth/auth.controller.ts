import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import type { LoginMethodsDto, LoginResponseDto, UserDto } from '@klappe/shared';
import type { Response } from 'express';
import { RateLimit } from '../common/rate-limit.guard';
import { AppConfig, CONFIG } from '../config/configuration';
import { AuthSettingsService } from '../settings/auth-settings.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { CurrentUser, Public } from './auth.decorators';
import { ChangePasswordDto, LoginDto } from './auth.dto';
import type { RequestUser } from './auth.types';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly authSettings: AuthSettingsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Welche Wege stehen offen? Ohne Anmeldung abfragbar (Phase 11). */
  @Public()
  @Get('methods')
  methods(): Promise<LoginMethodsDto> {
    return this.authSettings.getLoginMethods();
  }

  @Public()
  // Zehn Versuche je Adresse und Minute: bequem für Vertipper, unbrauchbar
  // fürs Durchprobieren von Passwörtern.
  @RateLimit({ name: 'login', limit: 10, windowMs: 60_000, identityField: 'email' })
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponseDto> {
    const user = await this.authService.validateLogin(dto.email, dto.password);

    // Die Prüfung kommt bewusst *nach* der Passwortprüfung: Sonst verriete
    // die Meldung, dass es das Konto gibt.
    if (!(await this.authSettings.isLocalLoginAllowed(user.role))) {
      throw new ForbiddenException(
        'Für Team-Konten ist nur die Anmeldung über Microsoft 365 erlaubt.',
      );
    }

    const token = await this.authService.issueToken(user);

    response.cookie(this.config.jwt.cookieName, token, {
      httpOnly: true,
      secure: this.config.jwt.cookieSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: this.config.jwt.ttlSeconds * 1000,
    });

    return { user: this.usersService.toDto(user) };
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) response: Response): void {
    response.clearCookie(this.config.jwt.cookieName, {
      httpOnly: true,
      secure: this.config.jwt.cookieSecure,
      sameSite: 'lax',
      path: '/',
    });
  }

  @Get('me')
  async me(@CurrentUser() user: RequestUser): Promise<UserDto> {
    return this.usersService.findByIdOrFail(user.id);
  }

  @RateLimit({ name: 'password', limit: 10, windowMs: 60_000 })
  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.authService.changePassword(user, dto.currentPassword, dto.newPassword);
  }
}
