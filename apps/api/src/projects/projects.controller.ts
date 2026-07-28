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

  @Get()
  async list(@CurrentUser() user: RequestUser): Promise<ProjectDto[]> {
    const scope = await this.accessService.loadScope(user);
    return this.projectsService.list(scope);
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
