import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { BackupModule } from './backup.module';
import { BackupSchedulerService } from './backup-scheduler.service';

/** Nur im Worker (Phase 23) – siehe `BackupSchedulerService`. */
@Module({
  // `QueueModule` wegen des Hinweises an die Admins, wenn eine geplante
  // Sicherung fehlschlägt (Phase 28).
  imports: [BackupModule, QueueModule],
  providers: [BackupSchedulerService],
})
export class BackupSchedulerModule {}
