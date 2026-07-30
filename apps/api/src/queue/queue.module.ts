import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import IORedis from 'ioredis';
import { AppConfig, CONFIG } from '../config/configuration';
import { MAIL_QUEUE, TRANSCODE_QUEUE } from './queue.constants';
import { MailQueueService } from './mail-queue.service';
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
    BullModule.registerQueue({
      name: MAIL_QUEUE,
      defaultJobOptions: {
        // Mailserver sind gelegentlich kurz nicht erreichbar; ein paar
        // Versuche mit wachsendem Abstand fangen das ab.
        attempts: 4,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 60 * 60 * 24, count: 1000 },
        removeOnFail: { age: 60 * 60 * 24 * 7 },
      },
    }),
  ],
  providers: [TranscodeQueueService, MailQueueService],
  exports: [BullModule, TranscodeQueueService, MailQueueService],
})
export class QueueModule {}
