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
import { IsBoolean, IsOptional } from 'class-validator';
import { Roles } from '../auth/auth.decorators';
import { GuestsService } from './guests.service';

class SetGuestActiveDto {
  @IsBoolean()
  isActive!: boolean;
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
