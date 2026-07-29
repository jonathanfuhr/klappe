import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { VersionDownloadsDto, VersionRenditionDto } from '@klappe/shared';
import type { Response } from 'express';
import { AccessService } from '../access/access.service';
import { CurrentUser } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { contentDisposition } from '../common/normalize';
import { sendFile } from '../media/send-file';
import { StorageService } from '../storage/storage.service';
import { RenditionsService } from './renditions.service';

/**
 * Das Download-Fenster einer Fassung (Phase 19).
 *
 * Drei Schritte: nachsehen, was angeboten wird – ein Format anfordern – die
 * fertige Datei holen. Die Rechteprüfung ist in allen drei Fällen dieselbe wie
 * beim Original: Ein Format ist ein Download, kein Nebeneingang.
 */
@Controller('v1/versions/:id/downloads')
export class RenditionsController {
  constructor(
    private readonly renditions: RenditionsService,
    private readonly accessService: AccessService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async list(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<VersionDownloadsDto> {
    const scope = await this.accessService.loadScope(user);
    return this.renditions.listForVersion(id, scope);
  }

  /** Format anfordern. Ist es schon da, kommt es unverändert zurück. */
  @Post(':presetId')
  async request(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('presetId', new ParseUUIDPipe()) presetId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<VersionRenditionDto> {
    const scope = await this.accessService.loadScope(user);
    return this.renditions.request(id, presetId, user.id, scope);
  }

  /**
   * Die fertige Datei. Solange sie noch entsteht, kommt hier bewusst ein 404
   * statt einer halben Datei – die Oberfläche zeigt in dieser Zeit den
   * Fortschritt.
   */
  @Get(':presetId/datei')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('presetId', new ParseUUIDPipe()) presetId: string,
    @Headers('range') range: string | undefined,
    @CurrentUser() user: RequestUser,
    @Res() response: Response,
  ): Promise<void> {
    const scope = await this.accessService.loadScope(user);
    const datei = await this.renditions.fileFor(id, presetId, scope);

    const size = await this.storage.size(datei.key);
    if (size === 0 && !(await this.storage.exists(datei.key))) {
      throw new NotFoundException('Die Datei ist auf dem Server nicht (mehr) vorhanden.');
    }

    response.setHeader('Content-Disposition', contentDisposition(datei.filename, false));
    sendFile({
      response,
      stream: (options) => this.storage.createReadStream(datei.key, options),
      size,
      contentType: datei.container === 'mov' ? 'video/quicktime' : 'video/mp4',
      rangeHeader: range,
      cacheControl: 'private, max-age=0, must-revalidate',
    });
  }
}
