/**
 * Die Endpunkte der Gerätekopplung (Phase 25).
 *
 * Drei davon sind öffentlich – sie müssen es sein, denn ein Plugin, das sich
 * gerade erst verbindet, hat noch keinen Ausweis. Geschützt sind sie durch
 * ihre Geheimnisse: Ohne den langen Gerätecode kommt niemand an einen Token,
 * und ausgestellt wird er erst, wenn ein angemeldeter Mensch im Browser
 * zugestimmt hat.
 */
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import type { DevicePendingDto, DeviceStartDto, DeviceTokenDto } from '@klappe/shared';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Public } from '../auth/auth.decorators';
import type { RequestUser } from '../auth/auth.types';
import { RateLimit } from '../common/rate-limit.guard';
import { DeviceFlowService } from './device-flow.service';

class StartDeviceDto {
  /** Wie sich das Gerät nennt; landet als Name in der Geräteliste. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientName?: string;
}

class DeviceCodeDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  deviceCode!: string;
}

class UserCodeDto {
  // Bindestrich und Schreibweise sind egal – der Dienst räumt die Eingabe auf.
  @IsString()
  @MinLength(8)
  @MaxLength(20)
  userCode!: string;
}

@Controller('v1/auth/geraet')
export class DeviceFlowController {
  constructor(private readonly devices: DeviceFlowService) {}

  /**
   * Schritt 1: Kopplung anmelden.
   *
   * Zwanzig Anläufe je Stunde und Herkunft. Ein Mensch, der ein Plugin
   * einrichtet, braucht einen – vielleicht drei, wenn etwas schiefgeht. Wer
   * hier anschlägt, sammelt Codes.
   */
  @Public()
  @RateLimit({ name: 'geraet-start', limit: 20, windowMs: 60 * 60 * 1000 })
  @Post('start')
  @HttpCode(200)
  start(@Body() dto: StartDeviceDto): Promise<DeviceStartDto> {
    return this.devices.start(dto.clientName);
  }

  /**
   * Schritt 3: Token abholen. Ein leerer Rumpf mit `202` heißt „noch nicht
   * bestätigt“ – das Plugin fragt später noch einmal.
   *
   * Die Bremse ist großzügig: Das Plugin *soll* wiederholt fragen. Gegen zu
   * schnelles Fragen steht der Zähler in der Kopplung selbst.
   */
  @Public()
  @RateLimit({ name: 'geraet-token', limit: 300, windowMs: 60 * 60 * 1000 })
  @Post('token')
  @HttpCode(200)
  async token(@Body() dto: DeviceCodeDto): Promise<DeviceTokenDto | { pending: true }> {
    const ergebnis = await this.devices.redeem(dto.deviceCode.trim());
    return ergebnis ?? { pending: true };
  }

  /**
   * Was der Browser vor dem Bestätigen anzeigt. Angemeldet sein ist Pflicht –
   * schon die Auskunft, dass sich gerade etwas verbinden will, geht nur die
   * an, die auch bestätigen könnten.
   */
  @Get(':userCode')
  describe(@Param('userCode') userCode: string): Promise<DevicePendingDto> {
    return this.devices.describe(userCode);
  }

  /**
   * Schritt 2: bestätigen. Hier hängt der Token an genau dem Konto, das
   * gerade angemeldet ist – deshalb braucht es keinen zweiten Nachweis.
   */
  @RateLimit({ name: 'geraet-bestaetigen', limit: 30, windowMs: 60 * 60 * 1000 })
  @Post('bestaetigen')
  @HttpCode(200)
  approve(@Body() dto: UserCodeDto, @CurrentUser() user: RequestUser): Promise<DevicePendingDto> {
    return this.devices.approve(dto.userCode, { id: user.id, name: user.name });
  }

  @RateLimit({ name: 'geraet-ablehnen', limit: 30, windowMs: 60 * 60 * 1000 })
  @Post('ablehnen')
  @HttpCode(204)
  deny(@Body() dto: UserCodeDto): Promise<void> {
    return this.devices.deny(dto.userCode);
  }
}
