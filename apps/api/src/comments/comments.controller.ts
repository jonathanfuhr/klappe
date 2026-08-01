import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { CommentDto } from '@klappe/shared';
import type { Response } from 'express';
import { AccessService } from '../access/access.service';
import { CurrentUser } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import {
  annotationHeightFor,
  clampAnnotationWidth,
  renderAnnotationPng,
} from './annotation-png';
import { CommentsService } from './comments.service';
import { CreateCommentDto, UpdateCommentDto } from './comments.dto';

/** Wie lange ein Client das PNG behalten darf, bevor er nachfragt. */
const ANNOTATION_CACHE_SECONDS = 300;

@Controller('v1')
export class CommentsController {
  constructor(
    private readonly commentsService: CommentsService,
    private readonly accessService: AccessService,
  ) {}

  @Get('versions/:versionId/comments')
  async list(
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Query('since') since: string | undefined,
    @CurrentUser() user: RequestUser,
  ): Promise<CommentDto[]> {
    const scope = await this.accessService.loadScope(user);
    return this.commentsService.listForVersion(versionId, scope, this.parseSince(since));
  }

  /**
   * Die Zeichnung eines Kommentars als fertiges PNG (Phase 27).
   *
   * Für Anbindungen, die keine eigene Raster-Logik haben – in der
   * Python-Umgebung von DaVinci Resolve gibt es keine Bildbibliothek. Das
   * Bild ist transparent und trägt das Seitenverhältnis der Fassung, liegt
   * also deckungsgleich über dem Frame.
   *
   * Die Rechte sind dieselben wie beim Kommentar selbst; interne Fassungen
   * fallen damit für Gäste auch hier weg.
   */
  @Get('comments/:id/annotation.png')
  async annotationPng(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('width') width: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @CurrentUser() user: RequestUser,
    @Res() response: Response,
  ): Promise<void> {
    const scope = await this.accessService.loadScope(user);
    const daten = await this.commentsService.annotationForRendering(id, scope);

    const breite = clampAnnotationWidth(width === undefined ? undefined : Number(width));
    const hoehe = annotationHeightFor(breite, daten.media);

    // Die Zeichnung ändert sich nur beim `PATCH` des Kommentars – der
    // Zeitstempel reicht also als Kennung, zusammen mit der Breite.
    const etag = `"${id}-${daten.updatedAt.getTime()}-${breite}"`;
    response.setHeader('ETag', etag);
    response.setHeader('Cache-Control', `private, max-age=${ANNOTATION_CACHE_SECONDS}`);
    response.setHeader('Content-Type', 'image/png');

    if (ifNoneMatch && ifNoneMatch.split(',').some((wert) => wert.trim() === etag)) {
      response.status(304).end();
      return;
    }

    const png = renderAnnotationPng(daten.annotation, breite, hoehe);
    response.setHeader('Content-Length', String(png.length));
    response.status(200).end(png);
  }

  @Post('versions/:versionId/comments')
  async create(
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CommentDto> {
    const scope = await this.accessService.loadScope(user);
    return this.commentsService.create(versionId, dto, user, scope);
  }

  @Patch('comments/:id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CommentDto> {
    const scope = await this.accessService.loadScope(user);
    return this.commentsService.update(id, dto, user, scope);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    const scope = await this.accessService.loadScope(user);
    return this.commentsService.remove(id, user, scope);
  }

  @Post('comments/:id/resolve')
  async resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<CommentDto> {
    const scope = await this.accessService.loadScope(user);
    return this.commentsService.setResolved(id, true, user, scope);
  }

  @Delete('comments/:id/resolve')
  async unresolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<CommentDto> {
    const scope = await this.accessService.loadScope(user);
    return this.commentsService.setResolved(id, false, user, scope);
  }

  /**
   * `?since=` als Datum lesen. Ein unlesbarer Wert wird abgewiesen statt
   * stillschweigend übergangen – sonst käme die volle Liste zurück und der
   * Aufrufer hielte sie für „das hat sich geändert".
   */
  private parseSince(since: string | undefined): Date | undefined {
    if (since === undefined || since.trim() === '') return undefined;
    const wert = new Date(since);
    if (Number.isNaN(wert.getTime())) {
      throw new BadRequestException('Der Wert von „since" ist kein gültiges Datum.');
    }
    return wert;
  }
}
