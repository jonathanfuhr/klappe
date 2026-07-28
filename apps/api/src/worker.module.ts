import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { TranscodeModule } from './transcode/transcode.module';
import { VersionsModule } from './versions/versions.module';

@Module({
  imports: [AppConfigModule, DbModule, StorageModule, QueueModule, VersionsModule, TranscodeModule],
})
export class WorkerModule {}
