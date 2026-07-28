import {
  Controller,
  Get,
  Head,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccessService } from '../access/access.service';
import { CurrentUser } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { contentDisposition } from '../common/normalize';
import { StorageService } from '../storage/storage.service';
import { VersionsService } from '../versions/versions.service';
import { contentTypeFor } from './range';
import { sendFile } from './send-file';

/**
 * Auslieferung der Mediendateien.
 *
 * Downloads liefern laut Konzept immer das Original, nie den Proxy – deshalb
 * gibt es getrennte Routen. Ob ein Gast das Original überhaupt bekommt, hängt
 * an drei Schaltern: dem Recht am Freigabe-Link, dem Schalter am Video und
 * dem an der Fassung.
 */
@Controller('v1/versions/:id')
export class MediaController {
  constructor(
    private readonly versionsService: VersionsService,
    private readonly accessService: AccessService,
    private readonly storage: StorageService,
  ) {}

  @Get('proxy')
  @Head('proxy')
  async proxy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('range') range: string | undefined,
    @CurrentUser() user: RequestUser,
    @Res() response: Response,
  ): Promise<void> {
    const scope = await this.accessService.loadScope(user);
    await this.accessService.requireVersion(scope, id);

    const version = await this.versionsService.getRowOrFail(id);
    if (!version.proxyKey) {
      throw new NotFoundException('Für diese Version gibt es noch keinen Proxy.');
    }

    response.setHeader(
      'Content-Disposition',
      contentDisposition(`${version.originalFilename}.proxy.mp4`, true),
    );
    // Die Pipeline liefert MP4; der Typ wird trotzdem aus dem abgelegten
    // Schlüssel bestimmt, damit ein anderes Proxy-Format später nicht
    // stillschweigend mit falschem Content-Type ausgeliefert wird.
    await this.deliver(response, version.proxyKey, contentTypeFor(version.proxyKey, 'video/mp4'), range, {
      immutable: false,
    });
  }

  @Get('original')
  @Head('original')
  async original(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('range') range: string | undefined,
    @Query('inline') inline: string | undefined,
    @CurrentUser() user: RequestUser,
    @Res() response: Response,
  ): Promise<void> {
    const scope = await this.accessService.loadScope(user);
    const access = await this.accessService.requireVersion(scope, id);
    this.accessService.assertCanDownload(scope, access);

    const version = await this.versionsService.getRowOrFail(id);
    if (!version.originalKey) {
      throw new NotFoundException('Das Original ist noch nicht vollständig hochgeladen.');
    }

    // Heruntergeladen wird unter dem vereinbarten Schema
    // (JJMMTT_Kunde_Projekt_Video_v2_1080p25.mov), nicht unter dem Namen,
    // den die Kamera oder das Schnittprogramm vergeben hat.
    const dto = await this.versionsService.findOneOrFail(id, scope);
    response.setHeader(
      'Content-Disposition',
      contentDisposition(dto.downloadFilename, inline === '1'),
    );
    await this.deliver(
      response,
      version.originalKey,
      version.originalMimeType || contentTypeFor(version.originalFilename),
      range,
      { immutable: false },
    );
  }

  @Get('poster')
  async poster(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
    @Res() response: Response,
  ): Promise<void> {
    const scope = await this.accessService.loadScope(user);
    await this.accessService.requireVersion(scope, id);

    const version = await this.versionsService.getRowOrFail(id);
    if (!version.posterKey) throw new NotFoundException('Kein Posterframe vorhanden.');

    response.setHeader('Content-Disposition', contentDisposition('poster.jpg', true));
    await this.deliver(response, version.posterKey, 'image/jpeg', undefined, { immutable: true });
  }

  @Get('sprite')
  async sprite(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
    @Res() response: Response,
  ): Promise<void> {
    const scope = await this.accessService.loadScope(user);
    await this.accessService.requireVersion(scope, id);

    const version = await this.versionsService.getRowOrFail(id);
    if (!version.spriteKey) throw new NotFoundException('Keine Timeline-Vorschau vorhanden.');

    response.setHeader('Content-Disposition', contentDisposition('sprite.jpg', true));
    await this.deliver(response, version.spriteKey, 'image/jpeg', undefined, { immutable: true });
  }

  private async deliver(
    response: Response,
    key: string,
    contentType: string,
    rangeHeader: string | undefined,
    options: { immutable: boolean },
  ): Promise<void> {
    const size = await this.storage.size(key);
    if (size === 0 && !(await this.storage.exists(key))) {
      throw new NotFoundException('Die Datei ist auf dem Server nicht (mehr) vorhanden.');
    }

    sendFile({
      response,
      stream: (streamOptions) => this.storage.createReadStream(key, streamOptions),
      size,
      contentType,
      rangeHeader,
      // Abgeleitete Dateien ändern sich nie – ihr Name enthält die Versions-ID.
      cacheControl: options.immutable
        ? 'private, max-age=604800, immutable'
        : 'private, max-age=0, must-revalidate',
    });
  }
}
