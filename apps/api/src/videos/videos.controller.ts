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
import type { VersionDto, VideoDto } from '@klappe/shared';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { StorageService } from '../storage/storage.service';
import { VersionsService } from '../versions/versions.service';
import { CreateVideoDto, UpdateVideoDto } from './videos.dto';
import { VideosService } from './videos.service';

@Controller('v1')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly versionsService: VersionsService,
    private readonly storage: StorageService,
  ) {}

  @Get('projects/:projectId/videos')
  list(@Param('projectId', new ParseUUIDPipe()) projectId: string): Promise<VideoDto[]> {
    return this.videosService.listForProject(projectId);
  }

  @Roles('ADMIN', 'MEMBER')
  @Post('projects/:projectId/videos')
  create(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: CreateVideoDto,
    @CurrentUser() user: RequestUser,
  ): Promise<VideoDto> {
    return this.videosService.create(projectId, dto, user);
  }

  @Get('videos/:id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<VideoDto> {
    return this.videosService.findOneOrFail(id);
  }

  @Get('videos/:id/versions')
  listVersions(@Param('id', new ParseUUIDPipe()) id: string): Promise<VersionDto[]> {
    return this.versionsService.listForVideo(id);
  }

  @Roles('ADMIN', 'MEMBER')
  @Patch('videos/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateVideoDto,
  ): Promise<VideoDto> {
    return this.videosService.update(id, dto);
  }

  @Roles('ADMIN', 'MEMBER')
  @Delete('videos/:id')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    const keys = await this.videosService.remove(id);
    for (const key of keys) {
      await this.storage.remove(key);
    }
  }
}
