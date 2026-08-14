import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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

  /**
   * Interne Fassung (Phase 27) – nachträglich in beide Richtungen umschaltbar.
   * `false` wirkt wie „Freigeben" und hält fest, wer wann freigegeben hat.
   */
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
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
        fileDate: dto.fileDate,
        isFinal: dto.isFinal,
        versionNumber: dto.versionNumber,
        internal: dto.internal,
      },
      scope,
      user,
    );

    // Wer „nur Endfassungen“ eingestellt hat, bekommt die Formate erst, wenn
    // der Haken gesetzt ist – also genau jetzt (Phase 19). Für eine
    // freigegebene Fassung gilt dasselbe: Solange sie intern war, hat die
    // Vorab-Erzeugung sie übersprungen (Phase 27).
    if (dto.isFinal === true || dto.internal === false) {
      await this.renditions.prebuildFor(id).catch(() => undefined);
    }
    return aktualisiert;
  }

  /**
   * Interne Fassung freigeben (Phase 27, geöffnet in 1.7).
   *
   * **Jeder aus dem Team** darf das, Mitglied wie Admin – die interne Runde
   * ist eine fachliche Entscheidung und kein Verwaltungsakt.
   *
   * Seit 1.7 auch der externe Projektadmin, wenn sein Link beide Rechte
   * trägt. Die Rolle steht deshalb offen und die Entscheidung fällt in
   * `canReleaseInternal` – die Rollenliste allein könnte „darf in *diesem*
   * Projekt" gar nicht ausdrücken.
   *
   * `requireVersion` wirft für den, der die Fassung nicht sehen darf, schon
   * ein „nicht gefunden": Ohne das Sehen-Recht kommt hier niemand an.
   */
  @Roles('ADMIN', 'MEMBER', 'GUEST')
  @Post(':id/freigeben')
  async release(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<VersionDto> {
    const scope = await this.accessService.loadScope(user);
    const version = await this.accessService.requireVersion(scope, id);
    if (!this.accessService.canReleaseInternal(scope, version.projectId)) {
      throw new ForbiddenException('Für das Freigeben interner Fassungen fehlen die Rechte.');
    }
    const freigegeben = await this.versionsService.release(id, user, scope);
    // Jetzt darf sie auch Formate bekommen.
    await this.renditions.prebuildFor(id).catch(() => undefined);
    return freigegeben;
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
