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
import { contentDisposition } from '../common/normalize';
import { StorageService } from '../storage/storage.service';
import { VersionsService } from '../versions/versions.service';
import { contentTypeFor, parseRange } from './range';

/**
 * Auslieferung der Mediendateien.
 *
 * Downloads liefern laut Konzept immer das Original, nie den Proxy – deshalb
 * gibt es getrennte Routen und `/original` setzt standardmäßig einen
 * Attachment-Header.
 */
@Controller('v1/versions/:id')
export class MediaController {
  constructor(
    private readonly versionsService: VersionsService,
    private readonly storage: StorageService,
  ) {}

  @Get('proxy')
  @Head('proxy')
  async proxy(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('range') range: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const version = await this.versionsService.getRowOrFail(id);
    if (!version.proxyKey) {
      throw new NotFoundException('Für diese Version gibt es noch keinen Proxy.');
    }
    // Die Pipeline liefert MP4; der Typ wird trotzdem aus dem abgelegten
    // Schlüssel bestimmt, damit ein anderes Proxy-Format später nicht
    // stillschweigend mit falschem Content-Type ausgeliefert wird.
    await this.send(response, version.proxyKey, contentTypeFor(version.proxyKey, 'video/mp4'), range, {
      filename: `${version.originalFilename}.proxy.mp4`,
      inline: true,
    });
  }

  @Get('original')
  @Head('original')
  async original(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('range') range: string | undefined,
    @Query('inline') inline: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const version = await this.versionsService.getRowOrFail(id);
    if (!version.originalKey) {
      throw new NotFoundException('Das Original ist noch nicht vollständig hochgeladen.');
    }
    await this.send(
      response,
      version.originalKey,
      version.originalMimeType || contentTypeFor(version.originalFilename),
      range,
      { filename: version.originalFilename, inline: inline === '1' },
    );
  }

  @Get('poster')
  async poster(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const version = await this.versionsService.getRowOrFail(id);
    if (!version.posterKey) throw new NotFoundException('Kein Posterframe vorhanden.');
    await this.send(response, version.posterKey, 'image/jpeg', undefined, {
      filename: 'poster.jpg',
      inline: true,
      immutable: true,
    });
  }

  @Get('sprite')
  async sprite(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const version = await this.versionsService.getRowOrFail(id);
    if (!version.spriteKey) throw new NotFoundException('Keine Timeline-Vorschau vorhanden.');
    await this.send(response, version.spriteKey, 'image/jpeg', undefined, {
      filename: 'sprite.jpg',
      inline: true,
      immutable: true,
    });
  }

  private async send(
    response: Response,
    key: string,
    contentType: string,
    rangeHeader: string | undefined,
    options: { filename: string; inline: boolean; immutable?: boolean },
  ): Promise<void> {
    const size = await this.storage.size(key);
    if (size === 0 && !(await this.storage.exists(key))) {
      throw new NotFoundException('Die Datei ist auf dem Server nicht (mehr) vorhanden.');
    }

    response.setHeader('Content-Type', contentType);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Content-Disposition', contentDisposition(options.filename, options.inline));
    // Abgeleitete Dateien ändern sich nie – ihr Name enthält die Versions-ID.
    response.setHeader(
      'Cache-Control',
      options.immutable ? 'private, max-age=604800, immutable' : 'private, max-age=0, must-revalidate',
    );

    const range = parseRange(rangeHeader, size);

    if (range.kind === 'unsatisfiable') {
      response.status(416).setHeader('Content-Range', `bytes */${size}`);
      response.end();
      return;
    }

    if (range.kind === 'full') {
      response.status(200).setHeader('Content-Length', String(size));
      if (response.req.method === 'HEAD') {
        response.end();
        return;
      }
      this.storage.createReadStream(key).pipe(response);
      return;
    }

    response.status(206);
    response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    response.setHeader('Content-Length', String(range.length));
    if (response.req.method === 'HEAD') {
      response.end();
      return;
    }
    this.storage.createReadStream(key, { start: range.start, end: range.end }).pipe(response);
  }
}
