import {
  Controller,
  Get,
  Head,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import { type EmbedDto, versionLabel } from '@klappe/shared';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { sendFile } from '../media/send-file';
import { StorageService } from '../storage/storage.service';
import { isSafeHlsFilename } from '../transcode/hls-plan';
import { EmbedService } from './embed.service';

/**
 * Eingebetteter Player.
 *
 * Alles hier ist **öffentlich** – ein `iframe` auf einer fremden Seite kann
 * keine Sitzung mitbringen, weil Browser Cookies von Drittanbietern blockieren.
 * Der Token in der Adresse ist deshalb der einzige Schlüssel, und daraus
 * folgen die Grenzen dieser Schnittstelle:
 *
 * - Sie greift nur, wenn am Freigabe-Link ausdrücklich `embedEnabled` steht.
 * - Sie liefert **nur die Abspielfassung**, nie das Original. Ein Download
 *   bliebe sonst an einer Adresse hängen, die auf jeder fremden Seite steht.
 * - Sie kennt keine Kommentare und keine Gästeliste.
 * - Zurückgezogene und abgelaufene Links fallen sofort durch.
 */
@Controller('v1/embed')
export class EmbedController {
  constructor(
    private readonly embedService: EmbedService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get(':token')
  async describe(@Param('token') token: string): Promise<EmbedDto> {
    const ziel = await this.embedService.resolveOrFail(token);
    return {
      title: ziel.videoName,
      versionId: ziel.version.id,
      versionLabel: versionLabel(Number(ziel.version.versionNumber)),
      isFinal: ziel.version.isFinal,
      width: ziel.version.proxyWidth ?? ziel.version.width,
      height: ziel.version.proxyHeight ?? ziel.version.height,
      durationSeconds: ziel.version.durationSeconds,
      hasPoster: Boolean(ziel.version.posterKey),
      // Nur wenn für diese Fassung wirklich eine Leiter erzeugt wurde – sonst
      // liefe der eingebettete Player in eine 404 statt in den Proxy.
      hasHls: Boolean(ziel.version.hlsKey),
      brandTitle: ziel.brandTitle,
    };
  }

  @Public()
  @Get(':token/versions/:id/proxy')
  @Head(':token/versions/:id/proxy')
  async proxy(
    @Param('token') token: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('range') range: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const version = await this.embedService.versionForOrFail(token, id);
    if (!version.proxyKey) {
      throw new NotFoundException('Für diese Fassung gibt es noch keine Abspielfassung.');
    }
    await this.deliver(response, version.proxyKey, 'video/mp4', range);
  }

  /**
   * HLS im eingebetteten Player (Phase 23).
   *
   * Dieselbe Leiter wie in der Review-Ansicht, nur ohne Sitzung: Der Token
   * in der Adresse weist aus, und `versionForOrFail` sorgt dafür, dass er nur
   * die Fassungen seiner eigenen Einbettung aufschließt. Der Dateiname wird
   * genauso streng geprüft wie dort – über einen Pfad in einer Playlist ließe
   * sich sonst aus dem Verzeichnis ausbrechen.
   */
  @Public()
  @Get(':token/versions/:id/hls/*path')
  async hls(
    @Param('token') token: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('path') path: string | string[],
    @Res() response: Response,
  ): Promise<void> {
    const version = await this.embedService.versionForOrFail(token, id);
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

    await this.deliver(response, key, typ, undefined);
  }

  @Public()
  @Get(':token/versions/:id/poster')
  @Head(':token/versions/:id/poster')
  async poster(
    @Param('token') token: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('range') range: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const version = await this.embedService.versionForOrFail(token, id);
    if (!version.posterKey) throw new NotFoundException('Kein Standbild vorhanden.');
    await this.deliver(response, version.posterKey, 'image/jpeg', range);
  }

  private async deliver(
    response: Response,
    key: string,
    contentType: string,
    range: string | undefined,
  ): Promise<void> {
    if (!(await this.storage.exists(key))) {
      throw new NotFoundException('Die Datei fehlt in der Ablage.');
    }
    // Kein `public` im Cache-Header: Die Adresse trägt den Token, und der
    // gehört nicht in einen geteilten Zwischenspeicher.
    sendFile({
      response,
      stream: (options) => this.storage.createReadStream(key, options),
      size: await this.storage.size(key),
      contentType,
      rangeHeader: range,
      cacheControl: 'private, max-age=300',
    });
  }
}
