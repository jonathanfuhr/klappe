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
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { CreateProjectDto, UpdateProjectDto } from './projects.dto';
import { ProjectsService } from './projects.service';

@Controller('v1/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  list(): Promise<ProjectDto[]> {
    return this.projectsService.list();
  }

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<ProjectDto> {
    return this.projectsService.findOneOrFail(id);
  }

  @Roles('ADMIN', 'MEMBER')
  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: RequestUser): Promise<ProjectDto> {
    return this.projectsService.create(dto, user);
  }

  @Roles('ADMIN', 'MEMBER')
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectDto> {
    return this.projectsService.update(id, dto);
  }

  @Roles('ADMIN', 'MEMBER')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.projectsService.remove(id);
  }
}
