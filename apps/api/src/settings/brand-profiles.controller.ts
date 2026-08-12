import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import type { BrandProfileDto } from '@klappe/shared';
import {
  MAX_BRAND_PROFILE_NAME_LENGTH,
  MAX_COMPANY_NAME_LENGTH,
  MAX_COMPANY_SHORT_LENGTH,
  MAX_LOGO_BYTES,
  MAX_MAIL_FROM_NAME_LENGTH,
} from '@klappe/shared';
import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import type { Request, Response } from 'express';
import { Public, Roles } from '../auth/auth.decorators';
import { StorageService } from '../storage/storage.service';
import { BrandProfilesService } from './brand-profiles.service';

class BrandProfileBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_BRAND_PROFILE_NAME_LENGTH)
  name?: string;

  /** Hex-Angabe wie `#4c8dff`; leer erbt die Farbe des Hauses. */
  @IsOptional()
  @IsString()
  @MaxLength(9)
  accent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_COMPANY_NAME_LENGTH)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_COMPANY_SHORT_LENGTH)
  companyShort?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_MAIL_FROM_NAME_LENGTH)
  mailFromName?: string;
}

class AssignBrandProfileDto {
  /** `null` nimmt den Auftritt ab – das Projekt trägt dann wieder unser CI. */
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  brandProfileId!: string | null;
}

/**
 * Auftritte: fremde Erscheinungsbilder pro Projekt (1.6).
 *
 * **Team-Sache.** Auch der externe Projektadmin (Phase 21) bleibt außen vor –
 * er ist in aller Regel genau die Agentur, um deren Auftritt es geht, und
 * dürfte sonst das Erscheinungsbild ändern, das andere Gäste zu sehen
 * bekommen. Damit steht es neben Umbenennen, Archivieren und Löschen, die
 * seit Phase 21 aus demselben Grund dem Team vorbehalten sind.
 *
 * Löschen gibt es nicht: Ein Auftritt, der einmal an einem Projekt hing,
 * bleibt. Das kostet eine Zeile in einer Tabelle und erspart die Frage, was
 * mit den Projekten geschehen soll, die noch daran hängen.
 */
@Controller('v1')
export class BrandProfilesController {
  constructor(
    private readonly profiles: BrandProfilesService,
    private readonly storage: StorageService,
  ) {}

  @Roles('ADMIN', 'MEMBER')
  @Get('brand-profiles')
  list(): Promise<BrandProfileDto[]> {
    return this.profiles.list();
  }

  /**
   * Das Logo ohne Anmeldung – wie beim Workspace-Logo. Das Gast-Gatter zeigt
   * es, bevor überhaupt jemand angemeldet ist; genau dafür ist es da.
   */
  @Public()
  @Get('brand-profiles/:id/logo')
  async logo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.profiles.getLogoFile(id);
    if (!file) throw new NotFoundException('Für diesen Auftritt gibt es kein Logo.');

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

  @Roles('ADMIN', 'MEMBER')
  @Post('brand-profiles')
  create(@Body() dto: BrandProfileBodyDto): Promise<BrandProfileDto> {
    return this.profiles.create(dto);
  }

  @Roles('ADMIN', 'MEMBER')
  @Put('brand-profiles/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: BrandProfileBodyDto,
  ): Promise<BrandProfileDto> {
    return this.profiles.update(id, dto);
  }

  /** Rohe Bytes im Rumpf, Format im `Content-Type` – wie beim Workspace-Logo. */
  @Roles('ADMIN', 'MEMBER')
  @Put('brand-profiles/:id/logo')
  async setLogo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: Request,
    @Headers('content-type') contentType: string | undefined,
  ): Promise<BrandProfileDto> {
    if (!contentType) throw new BadRequestException('Content-Type fehlt.');
    return this.profiles.setLogo(id, await readLogoBody(request), contentType);
  }

  @Roles('ADMIN', 'MEMBER')
  @Delete('brand-profiles/:id/logo')
  removeLogo(@Param('id', new ParseUUIDPipe()) id: string): Promise<BrandProfileDto> {
    return this.profiles.removeLogo(id);
  }

  /**
   * Auftritt eines Projekts setzen oder abnehmen. Steht hier statt beim
   * Projekt, damit alles zu den Auftritten an einer Stelle liegt.
   */
  @Roles('ADMIN', 'MEMBER')
  @Put('projects/:projectId/brand-profile')
  assign(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: AssignBrandProfileDto,
  ) {
    return this.profiles.assignToProject(projectId, dto.brandProfileId);
  }
}

/**
 * Rumpf einsammeln und dabei mitzählen. Die Grenze wird schon beim Lesen
 * gezogen, damit ein absichtlich riesiger Upload nicht erst vollständig im
 * Speicher landet.
 */
async function readLogoBody(request: Request): Promise<Buffer> {
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
