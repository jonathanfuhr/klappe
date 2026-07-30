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
  Put,
} from '@nestjs/common';
import type { TagDto } from '@klappe/shared';
import { MAX_TAG_NAME_LENGTH } from '@klappe/shared';
import { IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { TagsService } from './tags.service';

class CreateTagDto {
  @IsString()
  @MaxLength(MAX_TAG_NAME_LENGTH)
  name!: string;

  /** Ohne Angabe wird eine Farbe aus dem Namen abgeleitet. */
  @IsOptional()
  @IsString()
  @MaxLength(9)
  color?: string;
}

class UpdateTagDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TAG_NAME_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(9)
  color?: string;
}

class SetProjectTagsDto {
  @IsArray()
  @IsUUID('4', { each: true })
  tagIds!: string[];
}

/**
 * Schlagworte (Phase 12) – dem Team vorbehalten. Gäste sehen nur ihr eigenes
 * Projekt und hätten von einer workspace-weiten Liste nichts.
 */
@Controller('v1')
@Roles('ADMIN', 'MEMBER')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get('tags')
  list(): Promise<TagDto[]> {
    return this.tagsService.list();
  }

  @Post('tags')
  create(@Body() dto: CreateTagDto, @CurrentUser() user: RequestUser): Promise<TagDto> {
    return this.tagsService.create({ name: dto.name, color: dto.color }, user);
  }

  @Patch('tags/:id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateTagDto): Promise<TagDto> {
    return this.tagsService.update(id, { name: dto.name, color: dto.color });
  }

  @Delete('tags/:id')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.tagsService.remove(id);
  }

  /** Setzt die Schlagworte eines Projekts auf genau diese Liste. */
  @Put('projects/:projectId/tags')
  @HttpCode(204)
  setForProject(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: SetProjectTagsDto,
  ): Promise<void> {
    return this.tagsService.setForProject(projectId, dto.tagIds);
  }

  @Post('projects/:projectId/tags/:tagId')
  @HttpCode(204)
  attach(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('tagId', new ParseUUIDPipe()) tagId: string,
  ): Promise<void> {
    return this.tagsService.setOnProject(projectId, tagId, true);
  }

  @Delete('projects/:projectId/tags/:tagId')
  @HttpCode(204)
  detach(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('tagId', new ParseUUIDPipe()) tagId: string,
  ): Promise<void> {
    return this.tagsService.setOnProject(projectId, tagId, false);
  }
}
