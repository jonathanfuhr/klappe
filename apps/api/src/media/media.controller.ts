import {
  Controller,
  Get,
  Inject,
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
import { AllowMediaToken, CurrentUser } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { contentDisposition } from '../common/normalize';
import { AppConfig, CONFIG } from '../config/configuration';
import { StorageService } from '../storage/storage.service';
import { VersionsService } from '../versions/versions.service';
import { isSafeHlsFilename } from '../transcode/hls-plan';
import { type MediaKind, createMediaToken } from './media-token';
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
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Kurzlebige Links zu den Mediendateien (Phase 13).
   *
   * Nützlich überall dort, wo kein Sitzungs-Keks mitgeht: die Datei in VLC
   * öffnen, die Adresse in ein anderes Werkzeug kopieren. Die Rechte werden
   * beim Abruf trotzdem geprüft – ein entzogener Zugang macht auch einen
   * schon vergebenen Link wertlos.
   */
  @Get('media-links')
  async mediaLinks(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<Record<string, string | null>> {
    const scope = await this.accessService.loadScope(user);
    const access = await this.accessService.requireVersion(scope, id);
    const darfLaden = this.accessService.canDownload(scope, access);

    const link = (kind: MediaKind) => {
      const token = createMediaToken({ versionId: id, kind, userId: user.id }, this.config.jwt.secret);
      return `${this.config.publicUrl.replace(/\/+$/, '')}/v1/versions/${id}/${kind}?t=${token}`;
    };

    return {
      proxy: link('proxy'),
      poster: link('poster'),
      sprite: link('sprite'),
      // Ohne Download-Recht gibt es auch keinen Link – ein Token, der beim
      // Abruf ohnehin abgewiesen würde, wäre nur irreführend.
      original: darfLaden ? link('original') : null,
    };
  }

  @AllowMediaToken('proxy')
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

  @AllowMediaToken('original')
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

  @AllowMediaToken('poster')
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

  @AllowMediaToken('sprite')
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

  /**
   * HLS-Auslieferung (Phase 13).
   *
   * Die Master-Playlist verweist auf `<stufe>/index.m3u8`, die Stufen auf
   * ihre Segmente – beides relativ, deshalb genügt hier eine Route mit
   * Unterpfad. Der Dateiname wird streng geprüft: Über einen Pfad in einer
   * Playlist ließe sich sonst aus dem Verzeichnis ausbrechen.
   */
  @AllowMediaToken('hls')
  @Get('hls/*path')
  async hls(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('path') path: string | string[],
    @CurrentUser() user: RequestUser,
    @Res() response: Response,
  ): Promise<void> {
    const scope = await this.accessService.loadScope(user);
    await this.accessService.requireVersion(scope, id);

    const version = await this.versionsService.getRowOrFail(id);
    if (!version.hlsKey) {
      throw new NotFoundException('Für diese Fassung gibt es keine adaptive Wiedergabe.');
    }

    const teile = (Array.isArray(path) ? path : path.split('/')).filter(Boolean);
    if (teile.length === 0 || teile.length > 2) throw new NotFoundException('Unbekannter Pfad.');

    const datei = teile[teile.length - 1];
    const stufe = teile.length === 2 ? teile[0] : null;
    const stufen = version.hlsVariants?.split(',').filter(Boolean) ?? [];

    if (!isSafeHlsFilename(datei)) throw new NotFoundException('Unbekannter Pfad.');
    if (stufe !== null && !stufen.includes(stufe)) throw new NotFoundException('Unbekannte Stufe.');

    const key = stufe ? `${version.hlsKey}/${stufe}/${datei}` : `${version.hlsKey}/${datei}`;
    const typ = datei.endsWith('.m3u8')
      ? 'application/vnd.apple.mpegurl'
      : datei.endsWith('.ts')
        ? 'video/mp2t'
        : 'video/mp4';

    // Playlists dürfen nicht dauerhaft im Cache liegen, Segmente schon –
    // deren Name ändert sich mit jeder neuen Fassung.
    await this.deliver(response, key, typ, undefined, { immutable: !datei.endsWith('.m3u8') });
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
