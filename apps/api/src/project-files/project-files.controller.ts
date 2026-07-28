import {
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import type { ProjectFileDto } from '@klappe/shared';
import type { Response } from 'express';
import { AccessService } from '../access/access.service';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { contentDisposition } from '../common/normalize';
import { contentTypeFor } from '../media/range';
import { sendFile } from '../media/send-file';
import { StorageService } from '../storage/storage.service';
import { ProjectFilesService } from './project-files.service';

/** Kunden-Upload-Ordner eines Projekts (Phase 7). */
@Controller('v1')
export class ProjectFilesController {
  constructor(
    private readonly projectFilesService: ProjectFilesService,
    private readonly accessService: AccessService,
    private readonly storage: StorageService,
  ) {}

  @Get('projects/:projectId/files')
  async list(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<ProjectFileDto[]> {
    const scope = await this.accessService.loadScope(user);
    return this.projectFilesService.listForProject(projectId, scope, user);
  }

  @Get('project-files/:id/download')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
    @Headers('range') range: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const scope = await this.accessService.loadScope(user);
    const file = await this.projectFilesService.requireReadable(id, scope, user);

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
