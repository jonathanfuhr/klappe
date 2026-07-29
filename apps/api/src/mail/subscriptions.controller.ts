import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import type { NotificationSubscriberDto } from '@klappe/shared';
import { IsBoolean } from 'class-validator';
import { Roles } from '../auth/auth.decorators';
import { SubscriptionsService } from './subscriptions.service';

class SetSubscriptionDto {
  @IsBoolean()
  subscribed!: boolean;
}

/**
 * Die Spalte „Benachrichtigungen“ (Phase 18) – am Projekt und am Video.
 *
 * Dem Team vorbehalten, wie die Gästeübersicht auch: Wer hier hereinsieht,
 * sieht die Mailadressen aller Kolleginnen und Kollegen.
 */
@Controller('v1')
@Roles('ADMIN', 'MEMBER')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get('projects/:projectId/notifications')
  listForProject(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
  ): Promise<NotificationSubscriberDto[]> {
    return this.subscriptions.listForProject(projectId);
  }

  @Put('projects/:projectId/notifications/:userId')
  setForProject(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: SetSubscriptionDto,
  ): Promise<NotificationSubscriberDto[]> {
    return this.subscriptions.setForProject(projectId, userId, dto.subscribed);
  }

  @Get('videos/:videoId/notifications')
  listForVideo(
    @Param('videoId', new ParseUUIDPipe()) videoId: string,
  ): Promise<NotificationSubscriberDto[]> {
    return this.subscriptions.listForVideo(videoId);
  }

  @Put('videos/:videoId/notifications/:userId')
  setForVideo(
    @Param('videoId', new ParseUUIDPipe()) videoId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: SetSubscriptionDto,
  ): Promise<NotificationSubscriberDto[]> {
    return this.subscriptions.setForVideo(videoId, userId, dto.subscribed);
  }
}
