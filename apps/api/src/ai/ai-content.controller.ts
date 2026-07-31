import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { AiContentSettingsDto } from '@klappe/shared';
import { MAX_AI_KIND_NAME_LENGTH } from '@klappe/shared';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../auth/auth.decorators';
import { AiContentService } from './ai-content.service';

class CreateKindDto {
  @IsString()
  @MinLength(1, { message: 'Bitte eine Bezeichnung angeben.' })
  @MaxLength(MAX_AI_KIND_NAME_LENGTH)
  name!: string;
}

class RenameKindDto extends CreateKindDto {}

class UpdateAiSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * Katalog und Schalter der KI-Kennzeichnung (Phase 24, Nachtrag).
 *
 * Lesen darf das Team – die Videoseite bietet daraus die Auswahl an. Ändern
 * ist Admin-Sache. Gäste brauchen den Katalog nicht: Am Video stehen die
 * gewählten Arten mit Namen im DTO.
 */
@Controller('v1/ai-kinds')
export class AiContentController {
  constructor(private readonly aiContent: AiContentService) {}

  @Roles('ADMIN', 'MEMBER')
  @Get()
  getSettings(): Promise<AiContentSettingsDto> {
    return this.aiContent.getSettings();
  }

  /** Muss vor `:id` stehen, sonst frisst die UUID-Pipe das Wort „settings". */
  @Roles('ADMIN')
  @Patch('settings')
  updateSettings(@Body() dto: UpdateAiSettingsDto): Promise<AiContentSettingsDto> {
    if (dto.enabled === undefined) return this.aiContent.getSettings();
    return this.aiContent.setEnabled(dto.enabled);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateKindDto): Promise<AiContentSettingsDto> {
    return this.aiContent.createKind(dto.name);
  }

  @Roles('ADMIN')
  @Patch(':id')
  rename(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RenameKindDto,
  ): Promise<AiContentSettingsDto> {
    return this.aiContent.renameKind(id, dto.name);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<AiContentSettingsDto> {
    return this.aiContent.removeKind(id);
  }
}
