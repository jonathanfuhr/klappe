import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import IORedis from 'ioredis';
import { AppConfig, CONFIG } from '../config/configuration';
import { TRANSCODE_QUEUE } from './queue.constants';
import { TranscodeQueueService } from './transcode-queue.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [CONFIG],
      useFactory: (config: AppConfig) => ({
        // BullMQ verlangt für Worker `maxRetriesPerRequest: null`, sonst
        // bricht ioredis lange blockierende Kommandos ab.
        connection: new IORedis(config.redisUrl, { maxRetriesPerRequest: null }),
      }),
    }),
    BullModule.registerQueue({
      name: TRANSCODE_QUEUE,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: 60 * 60 * 24, count: 500 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      },
    }),
  ],
  providers: [TranscodeQueueService],
  exports: [BullModule, TranscodeQueueService],
})
export class QueueModule {}
