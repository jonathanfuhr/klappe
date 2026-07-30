import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import { Body } from '@nestjs/common';
import type { BrandingDto } from '@klappe/shared';
import {
  MAX_COMPANY_NAME_LENGTH,
  MAX_COMPANY_SHORT_LENGTH,
  MAX_LOGO_BYTES,
} from '@klappe/shared';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';
import { Public, Roles } from '../auth/auth.decorators';
import { StorageService } from '../storage/storage.service';
import { BrandingService } from './branding.service';

class UpdateBrandingDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  title?: string;

  /** Hex-Angabe wie `#4c8dff`; leer setzt auf die Standardfarbe zurück. */
  @IsOptional()
  @IsString()
  @MaxLength(9)
  accent?: string;

  /** Das Haus, dem der Workspace gehört (Phase 20). Leer entfernt den Eintrag. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_COMPANY_NAME_LENGTH)
  companyName?: string;

  /** Steht in Klammern hinter jedem Namen aus dem eigenen Team. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_COMPANY_SHORT_LENGTH)
  companyShort?: string;
}

/**
 * Erscheinungsbild des Workspace (Phase 10).
 *
 * Die Abfrage ist bewusst öffentlich: Anmeldeseite und Gast-Gatter sollen
 * Logo und Farbe zeigen, bevor überhaupt jemand angemeldet ist.
 */
@Controller('v1')
export class BrandingController {
  constructor(
    private readonly brandingService: BrandingService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get('branding')
  get(): Promise<BrandingDto> {
    return this.brandingService.get();
  }

  @Public()
  @Get('branding/logo')
  async logo(@Res() response: Response): Promise<void> {
    const file = await this.brandingService.getLogoFile();
    if (!file) throw new NotFoundException('Für diesen Workspace gibt es kein Logo.');

    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(await this.storage.size(file.key)));
    // Die Adresse trägt einen Zeitstempel; ein neues Logo kommt also unter
    // neuer Adresse und darf deshalb lange zwischengespeichert werden.
    response.setHeader('Cache-Control', 'public, max-age=3600');
    // Ein hochgeladenes SVG kann Skripte enthalten. Es wird zwar nur über
    // <img> eingebunden, wo nichts davon läuft – wer die Adresse aber direkt
    // öffnet, soll ebenfalls nichts ausführen.
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    response.setHeader('X-Content-Type-Options', 'nosniff');

    this.storage.createReadStream(file.key).pipe(response);
  }

  @Roles('ADMIN')
  @Put('settings/branding')
  update(@Body() dto: UpdateBrandingDto): Promise<BrandingDto> {
    return this.brandingService.update({
      title: dto.title,
      accent: dto.accent,
      companyName: dto.companyName,
      companyShort: dto.companyShort,
    });
  }

  /**
   * Logo hochladen: rohe Bytes im Rumpf, Format im `Content-Type`. Für eine
   * einzelne kleine Datei ist das schlichter als ein Formular-Upload – und
   * der Browser kann das `File`-Objekt direkt als Rumpf schicken.
   */
  @Roles('ADMIN')
  @Put('settings/branding/logo')
  async setLogo(
    @Req() request: Request,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<BrandingDto> {
    if (!contentType) throw new BadRequestException('Content-Type fehlt.');
    return this.brandingService.setLogo(await readBody(request), contentType);
  }

  @Roles('ADMIN')
  @Delete('settings/branding/logo')
  removeLogo(): Promise<BrandingDto> {
    return this.brandingService.removeLogo();
  }
}

/**
 * Rumpf einsammeln und dabei mitzählen. Die Grenze wird schon beim Lesen
 * gezogen, damit ein absichtlich riesiger Upload nicht erst vollständig im
 * Speicher landet.
 */
async function readBody(request: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buffer.length;
    if (total > MAX_LOGO_BYTES) {
      request.destroy();
      throw new BadRequestException(
        `Das Logo darf höchstens ${Math.round(MAX_LOGO_BYTES / 1024)} KB groß sein.`,
      );
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}
