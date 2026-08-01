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
import { IsBoolean, IsNumber, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { AccessService } from '../access/access.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { RenditionsService } from '../renditions/renditions.service';
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

  /**
   * Neue Nummer für diese Fassung (Phase 25) – zum Begradigen von
   * Fehleingaben. Geprüft wird im Dienst gegen die übrigen Fassungen.
   */
  @IsOptional()
  @IsNumber()
  versionNumber?: number;
}

@Controller('v1/versions')
export class VersionsController {
  constructor(
    private readonly versionsService: VersionsService,
    private readonly accessService: AccessService,
    private readonly storage: StorageService,
    private readonly renditions: RenditionsService,
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
    const aktualisiert = await this.versionsService.update(
      id,
      {
        label: dto.label === undefined ? undefined : dto.label.trim() || null,
        downloadEnabled: dto.downloadEnabled,
        fileDate: dto.fileDate,
        isFinal: dto.isFinal,
        versionNumber: dto.versionNumber,
      },
      scope,
    );

    // Wer „nur Endfassungen“ eingestellt hat, bekommt die Formate erst, wenn
    // der Haken gesetzt ist – also genau jetzt (Phase 19).
    if (dto.isFinal === true) {
      await this.renditions.prebuildFor(id).catch(() => undefined);
    }
    return aktualisiert;
  }

  /**
   * Team oder externer Projektadmin (Phase 21) – die Prüfung hängt am
   * Projekt der Fassung, deshalb kein `@Roles` hier, sondern die übliche
   * Zugriffsprüfung.
   */
  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    const scope = await this.accessService.loadScope(user);
    const access = await this.accessService.requireVersion(scope, id);
    this.accessService.assertCanManageProject(scope, access.projectId);

    const row = await this.versionsService.remove(id);
    for (const key of [row.originalKey, row.proxyKey, row.posterKey, row.spriteKey, row.hlsKey]) {
      if (key) await this.storage.remove(key);
    }
    // Die erzeugten Download-Formate liegen alle in einem Verzeichnis je
    // Fassung – eine Bewegung nimmt sie mit (Phase 19).
    await this.storage.remove(this.storage.keyForRenditionDir(id));
  }
}
