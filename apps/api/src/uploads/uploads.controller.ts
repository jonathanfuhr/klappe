import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import type { UploadSessionDto } from '@klappe/shared';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
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
}

/**
 * Resumable Upload nach tus 1.0.0.
 *
 * Ablauf: `POST` legt die Sitzung an (Antwort: `Location`), `HEAD` liefert den
 * aktuellen Stand, `PATCH` schiebt Chunks nach, `DELETE` bricht ab. Sobald der
 * letzte Chunk angekommen ist, wandert die Datei an ihren endgültigen Platz und
 * die Transcoding-Pipeline wird angestoßen.
 */
@Controller('v1')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

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
    // Zwei Wege in denselben Ablauf: klassische tus-Clients schicken die
    // Angaben in Headern, unsere Web-App als JSON.
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

    const session = await this.uploadsService.create({
      videoId,
      filename,
      sizeBytes,
      mimeType,
      label: dto.label?.trim() || null,
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
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const row = await this.uploadsService.getOrFail(id);
    response.setHeader('Tus-Resumable', TUS_VERSION);
    response.setHeader('Upload-Offset', String(row.offsetBytes));
    response.setHeader('Upload-Length', String(row.sizeBytes));
    // Ein zwischengespeicherter Offset wäre fatal: Der Client würde an der
    // falschen Stelle weiterschreiben.
    response.setHeader('Cache-Control', 'no-store');
  }

  @Roles('ADMIN', 'MEMBER')
  @Patch('uploads/:id')
  @HttpCode(204)
  async patch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers() headers: Record<string, string | undefined>,
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

    const contentLength = parseNonNegativeInteger(headers['content-length']);

    const result = await this.uploadsService.appendChunk({
      uploadId: id,
      clientOffset,
      body: request,
      contentLength,
    });

    response.setHeader('Tus-Resumable', TUS_VERSION);
    response.setHeader('Upload-Offset', String(result.offset));
    if (result.completed) {
      // Nicht Teil von tus, spart der Web-App aber eine Extra-Anfrage, um an
      // die entstandene Version zu kommen.
      response.setHeader('Klappe-Version-Id', result.row.versionId);
    }
  }

  @Roles('ADMIN', 'MEMBER')
  @Delete('uploads/:id')
  @HttpCode(204)
  async abort(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.uploadsService.abort(id);
    response.setHeader('Tus-Resumable', TUS_VERSION);
  }

  private setDiscoveryHeaders(response: Response): void {
    response.setHeader('Tus-Resumable', TUS_VERSION);
    response.setHeader('Tus-Version', TUS_SUPPORTED_VERSIONS);
    response.setHeader('Tus-Extension', TUS_EXTENSIONS);
  }
}
