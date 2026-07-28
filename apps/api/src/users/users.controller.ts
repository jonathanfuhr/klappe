import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { UserDto, UserSummaryDto } from '@klappe/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { CreateUserDto, UpdateMeDto, UpdateUserDto } from './users.dto';
import { UsersService } from './users.service';

@Controller('v1')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
  mentionable(@Query('q') query = ''): Promise<UserSummaryDto[]> {
    return this.usersService.searchMentionable(query);
  }
}
