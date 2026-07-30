import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { ShareGuestDto, ShareLinkDto } from '@klappe/shared';
import { AccessService } from '../access/access.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { CreateShareLinkDto, UpdateShareLinkDto } from './shares.dto';
import { SharesService } from './shares.service';

/**
 * Verwaltung der Freigaben.
 *
 * Anlegen und Einsehen ist seit Phase 21 auch einem externen Projektadmin
 * erlaubt, für sein eigenes Projekt – „weiter freigeben“. Ändern, Löschen und
 * die Verwaltung einzelner Gäste an einem Link bleiben dem Team vorbehalten:
 * Ein Projektadmin soll nicht versehentlich Zugänge kappen oder umstellen,
 * die das Team selbst eingerichtet hat.
 */
@Controller('v1')
export class SharesController {
  constructor(
    private readonly sharesService: SharesService,
    private readonly accessService: AccessService,
  ) {}

  @Get('projects/:projectId/shares')
  async listForProject(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ShareLinkDto[]> {
    const scope = await this.accessService.loadScope(user);
    this.accessService.assertCanManageProject(scope, projectId);
    return this.sharesService.listForProject(projectId);
  }

  @Get('videos/:videoId/shares')
  async listForVideo(
    @Param('videoId', new ParseUUIDPipe()) videoId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ShareLinkDto[]> {
    const scope = await this.accessService.loadScope(user);
    const video = await this.accessService.requireVideo(scope, videoId);
    this.accessService.assertCanManageProject(scope, video.projectId);
    return this.sharesService.listForVideo(videoId);
  }

  @Post('shares')
  async create(
    @Body() dto: CreateShareLinkDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ShareLinkDto> {
    const scope = await this.accessService.loadScope(user);
    if (dto.scope === 'PROJECT' && dto.projectId) {
      this.accessService.assertCanManageProject(scope, dto.projectId);
    } else if (dto.scope === 'VIDEO' && dto.videoId) {
      const video = await this.accessService.requireVideo(scope, dto.videoId);
      this.accessService.assertCanManageProject(scope, video.projectId);
    } else if (!scope.unrestricted) {
      // Ohne Ziel-ID lässt sich für ein Nicht-Team-Mitglied nichts prüfen –
      // ablehnen statt durchlassen. Fürs Team bleibt es bei der gewohnten
      // Fehlermeldung des Service, wenn die ID fehlt.
      throw new ForbiddenException('Dafür fehlen die Rechte.');
    }
    return this.sharesService.create(dto, user);
  }

  @Roles('ADMIN', 'MEMBER')
  @Patch('shares/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateShareLinkDto,
  ): Promise<ShareLinkDto> {
    return this.sharesService.update(id, dto);
  }

  @Roles('ADMIN', 'MEMBER')
  @Delete('shares/:id')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.sharesService.remove(id);
  }

  @Roles('ADMIN', 'MEMBER')
  @Get('shares/:id/guests')
  listGuests(@Param('id', new ParseUUIDPipe()) id: string): Promise<ShareGuestDto[]> {
    return this.sharesService.listGuests(id);
  }

  @Roles('ADMIN', 'MEMBER')
  @Delete('shares/:id/guests/:userId')
  @HttpCode(204)
  revokeGuest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    return this.sharesService.setGuestRevoked(id, userId, true);
  }

  @Roles('ADMIN', 'MEMBER')
  @Post('shares/:id/guests/:userId')
  @HttpCode(204)
  restoreGuest(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    return this.sharesService.setGuestRevoked(id, userId, false);
  }
}
