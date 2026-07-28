import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import type { VersionDto } from '@klappe/shared';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/auth.decorators';
import { StorageService } from '../storage/storage.service';
import { VersionsService } from './versions.service';

class UpdateVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;
}

@Controller('v1/versions')
export class VersionsController {
  constructor(
    private readonly versionsService: VersionsService,
    private readonly storage: StorageService,
  ) {}

  @Get(':id')
  findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<VersionDto> {
    return this.versionsService.findOneOrFail(id);
  }

  @Roles('ADMIN', 'MEMBER')
  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateVersionDto,
  ): Promise<VersionDto> {
    return this.versionsService.updateLabel(id, dto.label?.trim() || null);
  }

  @Roles('ADMIN', 'MEMBER')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    const row = await this.versionsService.remove(id);
    for (const key of [row.originalKey, row.proxyKey, row.posterKey, row.spriteKey]) {
      if (key) await this.storage.remove(key);
    }
  }
}
