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
  Query,
} from '@nestjs/common';
import type { ProjectDto } from '@klappe/shared';
import { AccessService } from '../access/access.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';
import { ProjectsService } from './projects.service';

@Controller('v1/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly accessService: AccessService,
  ) {}

  /**
   * Liste mit Filter und Sortierung (Phase 12).
   *
   * `tags` ist eine Komma-Liste von IDs, `tagMatch=all` verlangt sämtliche
   * davon statt nur eines. Unbekannte Werte werden still übergangen – ein
   * Filter soll keine Fehlermeldung erzeugen, sondern eine Liste.
   */
  @Get()
  async list(
    @CurrentUser() user: RequestUser,
    @Query('tags') tags?: string,
    @Query('tagMatch') tagMatch?: string,
    @Query('sort') sort?: string,
  ): Promise<ProjectDto[]> {
    const scope = await this.accessService.loadScope(user);
    return this.projectsService.list(scope, {
      tagIds: parseIdList(tags),
      tagMatch: tagMatch === 'all' ? 'all' : 'any',
      sort: sort === 'name' || sort === 'created' ? sort : 'updated',
    });
  }

  @Get(':id')
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectDto> {
    const scope = await this.accessService.loadScope(user);
    return this.projectsService.findOneOrFail(id, scope);
  }

  @Roles('ADMIN', 'MEMBER')
  @Post()
  async create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectDto> {
    const scope = await this.accessService.loadScope(user);
    return this.projectsService.create(dto, user, scope);
  }

  @Roles('ADMIN', 'MEMBER')
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectDto> {
    const scope = await this.accessService.loadScope(user);
    return this.projectsService.update(id, dto, scope);
  }

  @Roles('ADMIN', 'MEMBER')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.projectsService.remove(id);
  }
}

/** `"a,b , c"` → `['a','b','c']`, ohne Leeres und ohne Unfug. */
function parseIdList(value: string | undefined): string[] {
  if (!value) return [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => uuid.test(entry));
}
