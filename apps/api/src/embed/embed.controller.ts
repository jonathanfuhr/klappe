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
      width: ziel.version.proxyWidth ?? ziel.version.width,
      height: ziel.version.proxyHeight ?? ziel.version.height,
      durationSeconds: ziel.version.durationSeconds,
      hasPoster: Boolean(ziel.version.posterKey),
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
