import { Module } from '@nestjs/common';
import { BackupModule } from './backup.module';
import { BackupSchedulerService } from './backup-scheduler.service';

/** Nur im Worker (Phase 23) – siehe `BackupSchedulerService`. */
@Module({
  imports: [BackupModule],
  providers: [BackupSchedulerService],
})
export class BackupSchedulerModule {}
