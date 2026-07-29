import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Head,
  Headers,
  HttpCode,
  Options,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  VERSION_NUMBER_DECIMALS,
  VERSION_NUMBER_MAX,
  type UploadSessionDto,
} from '@klappe/shared';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { Request, Response } from 'express';
import { AccessService } from '../access/access.service';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import {
  TUS_CONTENT_TYPE,
  TUS_EXTENSIONS,
  TUS_SUPPORTED_VERSIONS,
  TUS_VERSION,
  filenameFromMetadata,
  parseNonNegativeInteger,
  parseUploadMetadata,
} from './tus';
import { UploadsService } from './uploads.service';

class CreateUploadDto {
  @IsOptional()
  @IsString()
  @MaxLength(400)
  filename?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  sizeBytes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  mimeType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  /** Datum der Fassung als `JJJJ-MM-TT`; ohne Angabe das heutige. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Das Datum muss im Format JJJJ-MM-TT stehen.' })
  fileDate?: string;

  /**
   * Frei gewählte Versionsnummer, auch mit Nachkommastelle (2.5). Ohne Angabe
   * zählt Klappe von der höchsten vorhandenen aus weiter.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: VERSION_NUMBER_DECIMALS })
  @Min(0.001)
  @Max(VERSION_NUMBER_MAX)
  versionNumber?: number;
}

class AssignUploadDto {
  @IsOptional()
  @IsUUID()
  videoId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  label?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Das Datum muss im Format JJJJ-MM-TT stehen.' })
  fileDate?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: VERSION_NUMBER_DECIMALS })
  @Min(0.001)
  @Max(VERSION_NUMBER_MAX)
  versionNumber?: number;
}

/**
 * Resumable Upload nach tus 1.0.0.
 *
 * Ablauf: `POST` legt die Sitzung an (Antwort: `Location`), `HEAD` liefert den
 * aktuellen Stand, `PATCH` schiebt Chunks nach, `DELETE` bricht ab. Sobald der
 * letzte Chunk angekommen ist, wandert die Datei an ihren endgültigen Platz.
 *
 * Zwei Ziele teilen sich diese Mechanik: neue Videofassungen (nur Team) und
 * Material im Kunden-Ordner (auch Gäste mit Upload-Recht, Phase 7).
 */
@Controller('v1')
export class UploadsController {
  constructor(
    private readonly uploadsService: UploadsService,
    private readonly accessService: AccessService,
  ) {}

  @Public()
  @Options('videos/:videoId/uploads')
  @HttpCode(204)
  optionsCreation(@Res({ passthrough: true }) response: Response): void {
    this.setDiscoveryHeaders(response);
  }

  @Public()
  @Options('uploads/:id')
  @HttpCode(204)
  optionsUpload(@Res({ passthrough: true }) response: Response): void {
    this.setDiscoveryHeaders(response);
  }

  /**
   * Upload ohne Ziel: Die Übertragung beginnt sofort, Projekt und Video werden
   * später mit `PATCH /v1/uploads/:id` nachgereicht. So wartet die lange
   * Übertragung nicht auf die kurze Eingabe.
   */
  @Roles('ADMIN', 'MEMBER')
  @Post('uploads')
  @HttpCode(201)
  async createUnassigned(
    @Body() dto: CreateUploadDto,
    @Headers() headers: Record<string, string | undefined>,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UploadSessionDto> {
    const details = this.readUploadDetails(dto, headers);
    const session = await this.uploadsService.create({
      videoId: null,
      filename: details.filename,
      sizeBytes: details.sizeBytes,
      mimeType: details.mimeType,
      label: dto.label?.trim() || null,
      fileDate: dto.fileDate ?? null,
      versionNumber: dto.versionNumber ?? null,
      user,
    });
    response.setHeader('Tus-Resumable', TUS_VERSION);
    response.setHeader('Location', session.location);
    return session;
  }

  /**
   * Die eigenen fertig übertragenen, noch unzugeordneten Sitzungen – die
   * Upload-Liste holt sie sich nach einem Seiten-Reload zurück (Phase 15).
   */
  @Roles('ADMIN', 'MEMBER')
  @Get('uploads')
  listUnassigned(@CurrentUser() user: RequestUser): Promise<UploadSessionDto[]> {
    return this.uploadsService.listUnassigned(user);
  }

  /** Zuordnung nachreichen; ist die Datei schon durch, entsteht die Fassung. */
  @Roles('ADMIN', 'MEMBER')
  @Patch('uploads/:id/ziel')
  async assign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignUploadDto,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UploadSessionDto> {
    const ergebnis = await this.uploadsService.assign(id, dto, user);
    if (ergebnis.versionId) response.setHeader('Klappe-Version-Id', ergebnis.versionId);
    return ergebnis.session;
  }

  @Roles('ADMIN', 'MEMBER')
  @Post('videos/:videoId/uploads')
  @HttpCode(201)
  async create(
    @Param('videoId', new ParseUUIDPipe()) videoId: string,
    @Body() dto: CreateUploadDto,
    @Headers() headers: Record<string, string | undefined>,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UploadSessionDto> {
    const details = this.readUploadDetails(dto, headers);

    const session = await this.uploadsService.create({
      videoId,
      filename: details.filename,
      sizeBytes: details.sizeBytes,
      mimeType: details.mimeType,
      label: dto.label?.trim() || null,
      fileDate: dto.fileDate ?? null,
      versionNumber: dto.versionNumber ?? null,
      user,
    });

    response.setHeader('Tus-Resumable', TUS_VERSION);
    response.setHeader('Location', session.location);
    return session;
  }

  /** Kunden-Upload in den Projektordner. */
  @Post('projects/:projectId/uploads')
  @HttpCode(201)
  async createProjectFile(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Body() dto: CreateUploadDto,
    @Headers() headers: Record<string, string | undefined>,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UploadSessionDto> {
    const scope = await this.accessService.loadScope(user);
    this.accessService.assertCanUploadToProject(scope, projectId);

    const details = this.readUploadDetails(dto, headers);
    const shareLinkId =
      scope.shares.find((share) => share.allowUpload && share.projectId === projectId)
        ?.shareLinkId ?? null;

    const session = await this.uploadsService.createProjectFileUpload({
      projectId,
      filename: details.filename,
      sizeBytes: details.sizeBytes,
      mimeType: details.mimeType,
      shareLinkId,
      user,
    });

    response.setHeader('Tus-Resumable', TUS_VERSION);
    response.setHeader('Location', session.location);
    return session;
  }

  @Head('uploads/:id')
  @HttpCode(200)
  async status(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const row = await this.uploadsService.getWritableOrFail(id, user);
    response.setHeader('Tus-Resumable', TUS_VERSION);
    response.setHeader('Upload-Offset', String(row.offsetBytes));
    response.setHeader('Upload-Length', String(row.sizeBytes));
    // Ein zwischengespeicherter Offset wäre fatal: Der Client würde an der
    // falschen Stelle weiterschreiben.
    response.setHeader('Cache-Control', 'no-store');
  }

  @Patch('uploads/:id')
  @HttpCode(204)
  async patch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers() headers: Record<string, string | undefined>,
    @CurrentUser() user: RequestUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const contentType = headers['content-type']?.split(';')[0]?.trim();
    if (contentType && contentType !== TUS_CONTENT_TYPE && contentType !== 'application/octet-stream') {
      throw new UnsupportedMediaTypeException(
        `Content-Type muss ${TUS_CONTENT_TYPE} sein, war aber ${contentType}.`,
      );
    }

    const clientOffset = parseNonNegativeInteger(headers['upload-offset']);
    if (clientOffset === null) {
      throw new BadRequestException('Upload-Offset fehlt oder ist ungültig.');
    }

    const result = await this.uploadsService.appendChunk({
      uploadId: id,
      clientOffset,
      body: request,
      contentLength: parseNonNegativeInteger(headers['content-length']),
      user,
    });

    response.setHeader('Tus-Resumable', TUS_VERSION);
    response.setHeader('Upload-Offset', String(result.offset));
    if (result.completed && result.row.versionId) {
      // Nicht Teil von tus, spart der Web-App aber eine Extra-Anfrage, um an
      // die entstandene Version zu kommen.
      response.setHeader('Klappe-Version-Id', result.row.versionId);
    }
  }

  @Delete('uploads/:id')
  @HttpCode(204)
  async abort(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.uploadsService.abort(id, user);
    response.setHeader('Tus-Resumable', TUS_VERSION);
  }

  /**
   * Zwei Wege in denselben Ablauf: klassische tus-Clients schicken die
   * Angaben in Headern, unsere Web-App als JSON.
   */
  private readUploadDetails(
    dto: CreateUploadDto,
    headers: Record<string, string | undefined>,
  ): { filename: string; sizeBytes: number; mimeType: string | null } {
    const metadata = parseUploadMetadata(headers['upload-metadata']);
    const headerLength = parseNonNegativeInteger(headers['upload-length']);

    const sizeBytes = dto.sizeBytes ?? headerLength;
    const filename = dto.filename?.trim() || filenameFromMetadata(metadata);
    const mimeType = dto.mimeType?.trim() || metadata.filetype || metadata.mimetype || null;

    if (sizeBytes === null || sizeBytes === undefined) {
      throw new BadRequestException('Upload-Length bzw. sizeBytes fehlt.');
    }
    if (!filename) {
      throw new BadRequestException('Der Dateiname fehlt.');
    }
    return { filename, sizeBytes, mimeType };
  }

  private setDiscoveryHeaders(response: Response): void {
    response.setHeader('Tus-Resumable', TUS_VERSION);
    response.setHeader('Tus-Version', TUS_SUPPORTED_VERSIONS);
    response.setHeader('Tus-Extension', TUS_EXTENSIONS);
  }
}
