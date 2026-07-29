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
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AccessService } from '../access/access.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { StorageService } from '../storage/storage.service';
import { VersionsService } from './versions.service';

class UpdateVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  /** Schalter für den Download dieser einen Fassung. */
  @IsOptional()
  @IsBoolean()
  downloadEnabled?: boolean;

  /** Datum im Dateinamen, `JJJJ-MM-TT`. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Das Datum muss im Format JJJJ-MM-TT stehen.' })
  fileDate?: string;

  /** Endfassung (Phase 17) – ohne Haken sieht der Kunde einen Hinweis. */
  @IsOptional()
  @IsBoolean()
  isFinal?: boolean;
}

@Controller('v1/versions')
export class VersionsController {
  constructor(
    private readonly versionsService: VersionsService,
    private readonly accessService: AccessService,
    private readonly storage: StorageService,
  ) {}

  @Get(':id')
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<VersionDto> {
    const scope = await this.accessService.loadScope(user);
    return this.versionsService.findOneOrFail(id, scope);
  }

  @Roles('ADMIN', 'MEMBER')
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateVersionDto,
    @CurrentUser() user: RequestUser,
  ): Promise<VersionDto> {
    const scope = await this.accessService.loadScope(user);
    return this.versionsService.update(
      id,
      {
        label: dto.label === undefined ? undefined : dto.label.trim() || null,
        downloadEnabled: dto.downloadEnabled,
        fileDate: dto.fileDate,
        isFinal: dto.isFinal,
      },
      scope,
    );
  }

  @Roles('ADMIN', 'MEMBER')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    const row = await this.versionsService.remove(id);
    for (const key of [row.originalKey, row.proxyKey, row.posterKey, row.spriteKey, row.hlsKey]) {
      if (key) await this.storage.remove(key);
    }
  }
}
