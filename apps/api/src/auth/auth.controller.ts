import { Body, Controller, Get, HttpCode, Inject, Post, Res } from '@nestjs/common';
import type { LoginResponseDto, UserDto } from '@klappe/shared';
import type { Response } from 'express';
import { AppConfig, CONFIG } from '../config/configuration';
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
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponseDto> {
    const user = await this.authService.validateLogin(dto.email, dto.password);
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

  @Post('password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.authService.changePassword(user, dto.currentPassword, dto.newPassword);
  }
}
