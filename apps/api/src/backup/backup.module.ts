import { Module } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

/**
 * Datenbanksicherung (Phase 23).
 *
 * Der Dienst hängt in beiden Prozessen: In der API bedient er die
 * Einstellungsseite, im Worker den Zeitplan (siehe `BackupSchedulerModule`).
 * Der Controller schadet im Worker nicht – dort läuft kein HTTP-Server.
 */
@Module({
  controllers: [BackupController],
  providers: [BackupService, SettingsService],
  exports: [BackupService],
})
export class BackupModule {}
