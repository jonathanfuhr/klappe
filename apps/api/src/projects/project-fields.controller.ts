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
import type { ProjectFieldDefDto } from '@klappe/shared';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { Roles } from '../auth/auth.decorators';
import { ProjectFieldsService } from './project-fields.service';

class CreateFieldDto {
  @IsString()
  @MinLength(1, { message: 'Bitte einen Feldnamen angeben.' })
  @MaxLength(100)
  name!: string;
}

class UpdateFieldDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/**
 * Verwaltung der Felddefinitionen (Phase 15). Lesen darf das Team – das
 * Formular am Projekt braucht die Liste –, verändern nur der Admin: Die
 * Definitionen sind Struktur des Workspace, wie Branding oder Anmeldung.
 */
@Controller('v1/project-fields')
export class ProjectFieldsController {
  constructor(private readonly projectFieldsService: ProjectFieldsService) {}

  @Roles('ADMIN', 'MEMBER')
  @Get()
  list(): Promise<ProjectFieldDefDto[]> {
    return this.projectFieldsService.list();
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateFieldDto): Promise<ProjectFieldDefDto> {
    return this.projectFieldsService.create(dto.name);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateFieldDto,
  ): Promise<ProjectFieldDefDto> {
    return this.projectFieldsService.update(id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.projectFieldsService.remove(id);
  }
}
