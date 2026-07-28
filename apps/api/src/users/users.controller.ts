import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { UserDto, UserSummaryDto } from '@klappe/shared';
import { IsString, MaxLength } from 'class-validator';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { AppConfig, CONFIG } from '../config/configuration';
import { RateLimit } from '../common/rate-limit.guard';
import { readUnsubscribeToken } from '../mail/unsubscribe-token';
import { CreateUserDto, UpdateMeDto, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

class UnsubscribeDto {
  @IsString()
  @MaxLength(500)
  token!: string;
}

@Controller('v1')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Roles('ADMIN')
  @Get('users')
  list(): Promise<UserDto[]> {
    return this.usersService.list();
  }

  @Roles('ADMIN')
  @Post('users')
  create(@Body() dto: CreateUserDto): Promise<UserDto> {
    return this.usersService.create(dto);
  }

  @Roles('ADMIN')
  @Patch('users/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserDto> {
    return this.usersService.update(id, dto);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: RequestUser, @Body() dto: UpdateMeDto): Promise<UserDto> {
    return this.usersService.updateMe(user.id, dto);
  }

  /** Vorschlagsliste für @-Mentions im Kommentar-Editor. */
  @Get('mentionable-users')
  mentionable(
    @CurrentUser() user: RequestUser,
    @Query('q') query = '',
  ): Promise<UserSummaryDto[]> {
    return this.usersService.searchMentionable(query, user.role);
  }

  /**
   * Abmeldung aus einer Benachrichtigungs-Mail. Ohne Anmeldung erreichbar –
   * der signierte Token im Link ist der Ausweis. Wer keine Mails mehr will,
   * soll sich dafür nicht erst einloggen müssen.
   */
  @Public()
  @RateLimit({ name: 'unsubscribe', limit: 20, windowMs: 60 * 60 * 1000 })
  @Post('unsubscribe')
  @HttpCode(200)
  async unsubscribe(@Body() dto: UnsubscribeDto): Promise<{ ok: boolean }> {
    const userId = readUnsubscribeToken(dto.token, this.config.jwt.secret);
    if (!userId) throw new BadRequestException('Dieser Abmelde-Link ist ungültig.');

    const ok = await this.usersService.disableNotifications(userId);
    if (!ok) throw new BadRequestException('Dieses Konto gibt es nicht mehr.');
    return { ok: true };
  }
}
