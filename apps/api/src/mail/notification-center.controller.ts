import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type { NotificationDto } from '@klappe/shared';
import { IsArray, IsOptional, IsUUID } from 'class-validator';
import { CurrentUser } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { NotificationCenterService } from './notification-center.service';

class MarkReadDto {
  /** Ohne Angabe gilt alles als gelesen. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  ids?: string[];
}

/**
 * Die Benachrichtigungszentrale (Phase 18). Jede angemeldete Person sieht
 * hier ihre eigenen Einträge – auch Gäste, denn auch sie werden erwähnt und
 * bekommen Antworten.
 */
@Controller('v1/notifications')
export class NotificationCenterController {
  constructor(private readonly center: NotificationCenterService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query('limit') limit?: string,
  ): Promise<NotificationDto[]> {
    const anzahl = Number(limit);
    return this.center.list(user, Number.isFinite(anzahl) && anzahl > 0 ? anzahl : 50);
  }

  /** Klein und oft abgefragt – deshalb getrennt von der Liste. */
  @Get('count')
  async count(@CurrentUser() user: RequestUser): Promise<{ unread: number }> {
    return { unread: await this.center.unreadCount(user.id) };
  }

  @Post('read')
  async markRead(
    @CurrentUser() user: RequestUser,
    @Body() dto: MarkReadDto,
  ): Promise<{ unread: number }> {
    return { unread: await this.center.markRead(user.id, dto.ids) };
  }

  /**
   * Die gelesenen Einträge entfernen (Phase 29) – das Gegenstück zum `POST`
   * auf denselben Pfad, der sie als gelesen markiert.
   *
   * Muss **vor** der Route mit Kennung stehen: Nest prüft in Reihenfolge der
   * Deklaration, und `:id` würde sonst „read" fangen und der `ParseUUIDPipe`
   * mit einem 400 antworten.
   */
  @Delete('read')
  async clearRead(@CurrentUser() user: RequestUser): Promise<{ unread: number }> {
    return { unread: await this.center.clearRead(user.id) };
  }

  @Delete(':id')
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ unread: number }> {
    return { unread: await this.center.remove(user.id, id) };
  }
}
