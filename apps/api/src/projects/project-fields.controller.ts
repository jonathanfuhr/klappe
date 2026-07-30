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
import type { FieldValueCountDto, ProjectFieldDefDto, ProjectFieldSettingsDto } from '@klappe/shared';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
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

  @IsOptional()
  @IsBoolean()
  suggest?: boolean;

  /** In der Sortier-Auswahl der Projektliste anbieten (Phase 22)? */
  @IsOptional()
  @IsBoolean()
  sortable?: boolean;

  /** In der Gruppier-Auswahl der Projektliste anbieten (Phase 22)? */
  @IsOptional()
  @IsBoolean()
  groupable?: boolean;

  /** Wert auf der Projektkachel anzeigen (Phase 22)? */
  @IsOptional()
  @IsBoolean()
  showOnTile?: boolean;
}

class UpdateFieldSettingsDto {
  @IsOptional()
  @IsBoolean()
  tagsEnabled?: boolean;
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

  /** Muss vor `:id` stehen, sonst frisst die UUID-Pipe das Wort „settings". */
  @Roles('ADMIN', 'MEMBER')
  @Get('settings')
  getSettings(): Promise<ProjectFieldSettingsDto> {
    return this.projectFieldsService.getSettings();
  }

  @Roles('ADMIN')
  @Patch('settings')
  updateSettings(@Body() dto: UpdateFieldSettingsDto): Promise<ProjectFieldSettingsDto> {
    return this.projectFieldsService.updateSettings(dto);
  }

  /** Vorkommende Werte eines Felds – für Filter und Tippvorschläge. */
  @Roles('ADMIN', 'MEMBER')
  @Get(':id/values')
  listValues(@Param('id', new ParseUUIDPipe()) id: string): Promise<FieldValueCountDto[]> {
    return this.projectFieldsService.listValues(id);
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
