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
import { CurrentUser } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { CommentsService } from './comments.service';
import { CreateCommentDto, UpdateCommentDto } from './comments.dto';

@Controller('v1')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get('versions/:versionId/comments')
  list(@Param('versionId', new ParseUUIDPipe()) versionId: string): Promise<CommentDto[]> {
    return this.commentsService.listForVersion(versionId);
  }

  @Post('versions/:versionId/comments')
  create(
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CommentDto> {
    return this.commentsService.create(versionId, dto, user);
  }

  @Patch('comments/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCommentDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CommentDto> {
    return this.commentsService.update(id, dto, user);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.commentsService.remove(id, user);
  }

  @Post('comments/:id/resolve')
  resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<CommentDto> {
    return this.commentsService.setResolved(id, true, user);
  }

  @Delete('comments/:id/resolve')
  unresolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<CommentDto> {
    return this.commentsService.setResolved(id, false, user);
  }
}
