import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { ShareGuestDto, ShareLinkDto } from '@klappe/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { CreateShareLinkDto, UpdateShareLinkDto } from './shares.dto';
import { SharesService } from './shares.service';

/** Verwaltung der Freigaben – ausschließlich für das Team. */
@Roles('ADMIN', 'MEMBER')
@Controller('v1')
export class SharesController {
  constructor(private readonly sharesService: SharesService) {}

  @Get('projects/:projectId/shares')
  listForProject(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Promise<ShareLinkDto[]> {
    return this.sharesService.listForProject(projectId);
  }

  @Get('videos/:videoId/shares')
  listForVideo(@Param('videoId', new ParseUUIDPipe()) videoId: string): Promise<ShareLinkDto[]> {
    return this.sharesService.listForVideo(videoId);
  }

  @Post('shares')
  create(
    @Body() dto: CreateShareLinkDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ShareLinkDto> {
    return this.sharesService.create(dto, user);
  }

  @Patch('shares/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateShareLinkDto,
  ): Promise<ShareLinkDto> {
    return this.sharesService.update(id, dto);
  }

  @Delete('shares/:id')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.sharesService.remove(id);
  }

  @Get('shares/:id/guests')
  listGuests(@Param('id', new ParseUUIDPipe()) id: string): Promise<ShareGuestDto[]> {
    return this.sharesService.listGuests(id);
  }

  @Delete('shares/:id/guests/:userId')
  @HttpCode(204)
  revokeGuest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    return this.sharesService.setGuestRevoked(id, userId, true);
  }

  @Post('shares/:id/guests/:userId')
  @HttpCode(204)
  restoreGuest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    return this.sharesService.setGuestRevoked(id, userId, false);
  }
}
