import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { SettingsService } from '../settings/settings.service';
import { ApiAccessController } from './api-access.controller';
import { ApiAccessService } from './api-access.service';
import { ApiTokensController } from './api-tokens.controller';
import { ApiTokensService } from './api-tokens.service';
import { DeviceFlowController } from './device-flow.controller';
import { DeviceFlowService } from './device-flow.service';

/**
 * Externe Anbindung (Phase 27): API-Tokens und die Gerätekopplung.
 *
 * `ApiTokensService` wird ausgeführt, weil der global aktive `JwtAuthGuard`
 * ihn braucht – ohne diesen Export käme keine einzige Anfrage mit einem
 * API-Token durch.
 */
@Module({
  // `QueueModule` wegen des Empfangsscheins bei einer Gerätekopplung (Phase 28).
  imports: [QueueModule],
  controllers: [ApiTokensController, ApiAccessController, DeviceFlowController],
  providers: [ApiTokensService, ApiAccessService, DeviceFlowService, SettingsService],
  exports: [ApiTokensService, DeviceFlowService],
})
export class ApiTokensModule {}
