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
import { AccessService } from '../access/access.service';
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
    private readonly accessService: AccessService,
    private readonly storage: StorageService,
  ) {}

  @Get('projects/:projectId/videos')
  async list(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<VideoDto[]> {
    const scope = await this.accessService.loadScope(user);
    return this.videosService.listForProject(projectId, scope);
  }

  @Roles('ADMIN', 'MEMBER')
  @Post('projects/:projectId/videos')
  async create(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: CreateVideoDto,
    @CurrentUser() user: RequestUser,
  ): Promise<VideoDto> {
    const scope = await this.accessService.loadScope(user);
    return this.videosService.create(projectId, dto, user, scope);
  }

  @Get('videos/:id')
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<VideoDto> {
    const scope = await this.accessService.loadScope(user);
    return this.videosService.findOneOrFail(id, scope);
  }

  @Get('videos/:id/versions')
  async listVersions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<VersionDto[]> {
    const scope = await this.accessService.loadScope(user);
    return this.versionsService.listForVideo(id, scope);
  }

  @Roles('ADMIN', 'MEMBER')
  @Patch('videos/:id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateVideoDto,
    @CurrentUser() user: RequestUser,
  ): Promise<VideoDto> {
    const scope = await this.accessService.loadScope(user);
    return this.videosService.update(id, dto, scope);
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
