import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { ProjectFileDto, ProjectFolderDto } from '@klappe/shared';
import archiver from 'archiver';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Response } from 'express';
import { AccessService } from '../access/access.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { contentDisposition, sanitizeFilename } from '../common/normalize';
import { contentTypeFor } from '../media/range';
import { sendFile } from '../media/send-file';
import { ProjectsService } from '../projects/projects.service';
import { StorageService } from '../storage/storage.service';
import { ProjectFilesService } from './project-files.service';
import { ProjectFoldersService } from './project-folders.service';

/** Eine Ordnerkette anlegen – „Neuer Ordner" ist schlicht ein Pfad der Länge 1. */
class EnsureFolderPathDto {
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  path!: string[];
}

class RenameFolderDto {
  @IsString()
  @MinLength(1, { message: 'Bitte einen Ordnernamen angeben.' })
  @MaxLength(200)
  name!: string;
}

/** Kunden-Upload-Ordner eines Projekts (Phase 7). */
@Controller('v1')
export class ProjectFilesController {
  constructor(
    private readonly projectFilesService: ProjectFilesService,
    private readonly projectFoldersService: ProjectFoldersService,
    private readonly projectsService: ProjectsService,
    private readonly accessService: AccessService,
    private readonly storage: StorageService,
  ) {}

  @Get('projects/:projectId/files')
  async list(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectFileDto[]> {
    const scope = await this.accessService.loadScope(user);
    return this.projectFilesService.listForProject(projectId, scope);
  }

  @Get('projects/:projectId/folders')
  async listFolders(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectFolderDto[]> {
    const scope = await this.accessService.loadScope(user);
    this.accessService.assertCanViewProject(scope, projectId);
    return this.projectFoldersService.listForProject(projectId);
  }

  /**
   * Ordnerkette anlegen (idempotent). Auch Gäste mit Upload-Recht dürfen das –
   * ohne Unterordner könnten sie keine ganzen Ordner hochladen.
   */
  @Post('projects/:projectId/folders')
  async ensureFolderPath(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: EnsureFolderPathDto,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectFolderDto> {
    const scope = await this.accessService.loadScope(user);
    this.accessService.assertCanUploadToProject(scope, projectId);
    const ordner = await this.projectFoldersService.ensurePath({
      projectId,
      parentId: dto.parentId ?? null,
      path: dto.path,
      userId: user.id,
    });
    const [dtoOrdner] = (await this.projectFoldersService.listForProject(projectId)).filter(
      (eintrag) => eintrag.id === ordner.id,
    );
    return dtoOrdner;
  }

  @Roles('ADMIN', 'MEMBER')
  @Patch('folders/:id')
  async renameFolder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RenameFolderDto,
  ): Promise<ProjectFolderDto> {
    return this.projectFoldersService.rename(id, dto.name);
  }

  /** Löscht den Ordner samt Unterordnern und Dateien – nur Team. */
  @Roles('ADMIN', 'MEMBER')
  @Delete('folders/:id')
  @HttpCode(204)
  async removeFolder(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    const keys = await this.projectFoldersService.remove(id);
    for (const key of keys) {
      await this.storage.remove(key);
    }
  }

  /**
   * Der ganze Kunden-Bereich (oder ein Ordner daraus) als ZIP-Strom –
   * für Kunde und Team gleichermaßen (Phase 15).
   *
   * Ohne Kompression (`store`): Das Material ist Video und bereits verdichtet;
   * deflate würde nur CPU verbrennen und den Strom bremsen.
   */
  @Get('projects/:projectId/files.zip')
  async downloadZip(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @CurrentUser() user: RequestUser,
    @Res() response: Response,
    @Query('folder') folderId?: string,
  ): Promise<void> {
    const scope = await this.accessService.loadScope(user);
    this.accessService.assertCanViewProject(scope, projectId);

    const dateien = await this.projectFilesService.listRowsForProject(projectId);
    const pfade = await this.projectFoldersService.pathMap(projectId);

    // Nur der Teilbaum unter `folder`, wenn eines angefragt ist.
    let wurzelPfad: string[] = [];
    if (folderId) {
      const ordner = await this.projectFoldersService.requireInProject(folderId, projectId);
      wurzelPfad = pfade.get(ordner.id) ?? [];
    }
    const imTeilbaum = (datei: { folderId: string | null }): boolean => {
      if (!folderId) return true;
      if (!datei.folderId) return false;
      const pfad = pfade.get(datei.folderId) ?? [];
      return (
        pfad.length >= wurzelPfad.length &&
        wurzelPfad.every((segment, index) => pfad[index] === segment)
      );
    };
    const auswahl = dateien.filter(imTeilbaum);
    if (auswahl.length === 0) {
      throw new NotFoundException('In diesem Ordner liegen keine Dateien.');
    }

    const projekt = await this.projectsService.findOneOrFail(projectId, scope);
    const zipName = sanitizeFilename(
      `${folderId ? wurzelPfad[wurzelPfad.length - 1] : projekt.name}-Dateien.zip`,
    );

    response.setHeader('Content-Type', 'application/zip');
    response.setHeader('Content-Disposition', contentDisposition(zipName, false));
    response.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

    const archiv = archiver('zip', { store: true });
    archiv.on('error', () => response.destroy());
    // Bricht der Browser ab, soll das Sammeln sofort enden.
    response.on('close', () => void archiv.abort());
    archiv.pipe(response);

    for (const datei of auswahl) {
      const ordnerPfad = datei.folderId ? (pfade.get(datei.folderId) ?? []) : [];
      const relativ = ordnerPfad.slice(wurzelPfad.length);
      archiv.append(this.storage.createReadStream(datei.storageKey), {
        name: [...relativ, datei.filename].join('/'),
      });
    }
    await archiv.finalize();
  }

  @Get('project-files/:id/download')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
    @Headers('range') range: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const scope = await this.accessService.loadScope(user);
    const file = await this.projectFilesService.requireReadable(id, scope);

    const size = await this.storage.size(file.storageKey);
    if (size === 0 && !(await this.storage.exists(file.storageKey))) {
      throw new NotFoundException('Die Datei ist auf dem Server nicht (mehr) vorhanden.');
    }

    response.setHeader('Content-Disposition', contentDisposition(file.filename, false));
    sendFile({
      response,
      stream: (options) => this.storage.createReadStream(file.storageKey, options),
      size,
      contentType: file.mimeType || contentTypeFor(file.filename),
      rangeHeader: range,
      cacheControl: 'private, max-age=0, must-revalidate',
    });
  }

  /** Löschen bleibt beim Team – Kundenmaterial verschwindet nicht von selbst. */
  @Roles('ADMIN', 'MEMBER')
  @Delete('project-files/:id')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    return this.projectFilesService.remove(id);
  }
}
