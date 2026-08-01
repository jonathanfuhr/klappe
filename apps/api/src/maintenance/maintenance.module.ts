import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { SettingsService } from '../settings/settings.service';
import { MaintenanceService } from './maintenance.service';

// `SettingsService` wegen der Aufbewahrungsfrist archivierter Projekte
// (Phase 18) – sie steht in den Einstellungen, nicht im Code.
@Module({
  // `QueueModule` wegen der Warnung vor dem Aufräumen (Phase 28).
  imports: [QueueModule],
  providers: [MaintenanceService, SettingsService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
