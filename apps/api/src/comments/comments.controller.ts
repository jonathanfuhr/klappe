import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import type { CommentDto } from '@klappe/shared';
import { AccessService } from '../access/access.service';
import { CurrentUser } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { CommentsService } from './comments.service';
import { CreateCommentDto, UpdateCommentDto } from './comments.dto';

@Controller('v1')
export class CommentsController {
  constructor(
    private readonly commentsService: CommentsService,
    private readonly accessService: AccessService,
  ) {}

  @Get('versions/:versionId/comments')
  async list(
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<CommentDto[]> {
    const scope = await this.accessService.loadScope(user);
    return this.commentsService.listForVersion(versionId, scope);
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
}
