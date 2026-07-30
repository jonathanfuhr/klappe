import { Module } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { MaintenanceService } from './maintenance.service';

// `SettingsService` wegen der Aufbewahrungsfrist archivierter Projekte
// (Phase 18) – sie steht in den Einstellungen, nicht im Code.
@Module({
  providers: [MaintenanceService, SettingsService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
