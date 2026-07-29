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
import type { GuestAccessDto, GuestOverviewDto } from '@klappe/shared';
import { IsArray, IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { GuestsService } from './guests.service';

class SetGuestActiveDto {
  @IsBoolean()
  isActive!: boolean;
}

/**
 * Erweitern eines vorhandenen Gastes (Phase 18): entweder aufs ganze Projekt
 * oder auf einzelne weitere Videos daraus.
 */
class ExtendGuestDto {
  @IsIn(['PROJECT', 'VIDEO'])
  scope!: 'PROJECT' | 'VIDEO';

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  videoIds?: string[];
}

/** `null` setzt das Recht zurück auf „wie der Link". */
class SetGuestRightsDto {
  @IsOptional()
  @IsBoolean()
  allowComments?: boolean | null;

  @IsOptional()
  @IsBoolean()
  allowDownload?: boolean | null;

  @IsOptional()
  @IsBoolean()
  allowUpload?: boolean | null;
}

/**
 * Gäste- und Rechteübersicht (Phase 9).
 *
 * Alles hier ist dem Team vorbehalten – ein Gast soll nicht sehen, wer sonst
 * noch am Projekt sitzt.
 */
@Controller('v1')
@Roles('ADMIN', 'MEMBER')
export class GuestsController {
  constructor(private readonly guestsService: GuestsService) {}

  @Get('projects/:projectId/guests')
  listForProject(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Promise<GuestAccessDto[]> {
    return this.guestsService.listForProject(projectId);
  }

  @Get('videos/:videoId/guests')
  listForVideo(@Param('videoId', new ParseUUIDPipe()) videoId: string): Promise<GuestAccessDto[]> {
    return this.guestsService.listForVideo(videoId);
  }

  /** Alle Gastkonten des Workspace mit den Projekten, die sie erreichen. */
  @Get('guests')
  listAll(): Promise<GuestOverviewDto[]> {
    return this.guestsService.listAll();
  }

  /** Diesem Gast den Zugriff auf das ganze Projekt entziehen. */
  @Delete('projects/:projectId/guests/:userId')
  revokeProjectAccess(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<GuestAccessDto[]> {
    return this.guestsService.setProjectAccessRevoked(projectId, userId, true);
  }

  /**
   * Einen vorhandenen Gast erweitern – aufs ganze Projekt oder auf einzelne
   * weitere Videos. Ohne neuen Link, ohne neue Mail (Phase 18).
   */
  @Post('projects/:projectId/guests/:userId/erweitern')
  extend(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: ExtendGuestDto,
    @CurrentUser() actor: RequestUser,
  ): Promise<GuestAccessDto[]> {
    return this.guestsService.extendAccess(
      projectId,
      userId,
      dto.scope === 'PROJECT'
        ? { scope: 'PROJECT' }
        : { scope: 'VIDEO', videoIds: dto.videoIds ?? [] },
      actor.id,
    );
  }

  @Post('projects/:projectId/guests/:userId')
  restoreProjectAccess(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<GuestAccessDto[]> {
    return this.guestsService.setProjectAccessRevoked(projectId, userId, false);
  }

  /** Gastkonto sperren oder entsperren – gilt über alle Projekte hinweg. */
  /**
   * Rechte einer Person an einem Link (Phase 16). `null` heißt „wie der Link“,
   * damit sich eine Ausnahme auch wieder zurücknehmen lässt.
   */
  @Patch('shares/:shareLinkId/guests/:userId/rechte')
  @HttpCode(204)
  async setRights(
    @Param('shareLinkId', new ParseUUIDPipe()) shareLinkId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: SetGuestRightsDto,
  ): Promise<void> {
    await this.guestsService.setGuestRights(shareLinkId, userId, dto);
  }

  @Roles('ADMIN')
  @Patch('guests/:userId')
  setActive(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: SetGuestActiveDto,
  ): Promise<GuestOverviewDto[]> {
    return this.guestsService.setAccountActive(userId, dto.isActive);
  }
}
