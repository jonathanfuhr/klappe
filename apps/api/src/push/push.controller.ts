import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { PushKeyDto, PushStateDto } from '@klappe/shared';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { PushKeysService } from './push-keys.service';
import { PushService } from './push.service';

/**
 * Endpunkte sind lang, aber nicht beliebig lang – die Grenze hält jemanden
 * davon ab, die Tabelle mit einem Megabyte Text zu füllen.
 */
class SubscribeDto {
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  endpoint!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  p256dh!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  auth!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  userAgent?: string;
}

class UnsubscribeDto {
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  endpoint!: string;
}

/**
 * An- und Abmelden für Push (Phase 29).
 *
 * Steht jeder angemeldeten Person offen, auch Gästen: Bei denselben
 * Ansprechpartnern über viele Projekte hinweg landet Klappe durchaus auf
 * einem Sperrbildschirm, und ein Gast, der das will, soll es haben.
 */
@Controller('v1/push')
export class PushController {
  constructor(
    private readonly push: PushService,
    private readonly keys: PushKeysService,
  ) {}

  /**
   * Der öffentliche Schlüssel. Beim ersten Abruf entsteht das Paar – erst
   * hier, nicht beim Start: Eine Anlage, in der niemand Push einschaltet,
   * braucht auch keine Schlüssel.
   */
  @Get('key')
  async key(): Promise<PushKeyDto> {
    return { publicKey: await this.keys.publicKey() };
  }

  /** Ist genau dieser Browser angemeldet? */
  @Get('state')
  async state(
    @CurrentUser() user: RequestUser,
    @Query('endpoint') endpoint?: string,
  ): Promise<PushStateDto> {
    if (!endpoint) return { subscribed: false };
    return { subscribed: await this.push.isSubscribed(user.id, endpoint) };
  }

  @Post('subscribe')
  async subscribe(
    @CurrentUser() user: RequestUser,
    @Body() dto: SubscribeDto,
  ): Promise<PushStateDto> {
    await this.push.subscribe(user.id, dto);
    return { subscribed: true };
  }

  @Post('unsubscribe')
  async unsubscribe(@Body() dto: UnsubscribeDto): Promise<PushStateDto> {
    await this.push.unsubscribe(dto.endpoint);
    return { subscribed: false };
  }
}
