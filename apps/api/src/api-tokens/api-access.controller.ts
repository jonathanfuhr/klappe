/**
 * Der Admin-Bereich zum externen Zugriff (Phase 25): der Schalter selbst und
 * die Liste aller verbundenen Geräte des Workspace.
 *
 * Liegt bewusst hier und nicht im `SettingsController`: Der Schalter allein
 * wäre dort gut aufgehoben, aber die Geräteliste gehört fachlich zu den
 * Tokens, und beides in einer Datei hält die Zuständigkeit beisammen.
 */
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import type { ApiAccessSettingsDto, ApiTokenDto } from '@klappe/shared';
import { IsBoolean } from 'class-validator';
import { CurrentUser, Roles } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { ApiAccessService } from './api-access.service';
import { ApiTokensService } from './api-tokens.service';

class UpdateApiAccessDto {
  @IsBoolean()
  enabled!: boolean;
}

@Controller('v1/settings')
export class ApiAccessController {
  constructor(
    private readonly access: ApiAccessService,
    private readonly tokens: ApiTokensService,
  ) {}

  @Roles('ADMIN')
  @Get('api-zugriff')
  get(): Promise<ApiAccessSettingsDto> {
    return this.access.get();
  }

  /**
   * Umlegen des Schalters. Abschalten wirkt sofort und trifft **alle**
   * Geräte auf einmal – die Tokens bleiben dabei bestehen und gelten wieder,
   * sobald der Schalter zurückgeht. Wer ein einzelnes Gerät dauerhaft los
   * werden will, trennt es unten in der Liste.
   */
  @Roles('ADMIN')
  @Put('api-zugriff')
  update(@Body() dto: UpdateApiAccessDto): Promise<ApiAccessSettingsDto> {
    return this.access.update(dto.enabled);
  }

  /** Alle Geräte des Workspace, mit Konto dazu. */
  @Roles('ADMIN')
  @Get('geraete')
  list(): Promise<ApiTokenDto[]> {
    return this.tokens.listAll();
  }

  /** Jedes Gerät im Workspace trennen – auch fremde. Nur der Administrator. */
  @Roles('ADMIN')
  @Delete('geraete/:id')
  @HttpCode(204)
  revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    return this.tokens.revoke(id, user, 'any');
  }
}
