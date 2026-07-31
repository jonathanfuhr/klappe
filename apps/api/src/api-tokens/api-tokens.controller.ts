/**
 * Verbundene Geräte verwalten (Phase 25).
 *
 * Zwei Sichten auf dieselbe Sache, und die Trennung ist Absicht:
 *
 * - `/v1/geraete` gehört **jedem** Angemeldeten. Wer ein Plugin verbunden hat,
 *   sieht seine eigenen Geräte und trennt sie selbst – ohne den Administrator
 *   zu fragen. Wer seinen Laptop verliert, soll nicht erst jemanden suchen
 *   müssen.
 * - `/v1/settings/geraete` gehört dem **Administrator**. Er sieht alle Geräte
 *   des Workspace mitsamt Konto und kann jedes trennen. Ohne das könnte er
 *   den externen Zugriff zwar insgesamt abschalten, aber nicht ein einzelnes
 *   Gerät entfernen.
 */
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { ApiTokenDto } from '@klappe/shared';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { RateLimit } from '../common/rate-limit.guard';
import { ApiTokensService } from './api-tokens.service';

class CreateTokenDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;
}

@Controller('v1/geraete')
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokensService) {}

  /** Die eigenen verbundenen Geräte. */
  @Get()
  list(@CurrentUser() user: RequestUser): Promise<ApiTokenDto[]> {
    return this.tokens.listForUser(user.id);
  }

  /**
   * Einen Token von Hand ausstellen – für Skripte und Automatisierung, wo
   * niemand am Bildschirm sitzt, um eine Kopplung zu bestätigen. Der
   * Klartext steht **nur in dieser einen Antwort**.
   *
   * Für Plugins ist das nicht der vorgesehene Weg: Die bringen sich über die
   * Gerätekopplung selbst mit, ohne dass jemand einen Token kopieren muss.
   */
  @RateLimit({ name: 'geraet-anlegen', limit: 20, windowMs: 60 * 60 * 1000 })
  @Post()
  @HttpCode(201)
  async create(
    @Body() dto: CreateTokenDto,
    @CurrentUser() user: RequestUser,
  ): Promise<{ token: ApiTokenDto; plaintext: string }> {
    return this.tokens.issue({ userId: user.id, name: dto.name, origin: 'manual' });
  }

  /**
   * Ein eigenes Gerät trennen. Wirkt sofort – die nächste Anfrage fällt durch.
   * Ausschließlich eigene: An fremde kommt auch ein Admin nur über die
   * Verwaltungsroute.
   */
  @Delete(':id')
  @HttpCode(204)
  revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.tokens.revoke(id, user, 'own');
  }

  /** Alle eigenen Geräte auf einmal – der Knopf für den Ernstfall. */
  @Delete()
  @HttpCode(204)
  async revokeAll(@CurrentUser() user: RequestUser): Promise<void> {
    await this.tokens.revokeAllForUser(user.id, user);
  }
}
