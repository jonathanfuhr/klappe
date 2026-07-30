import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Eigener Prozess für die Transcoding-Pipeline. Kein HTTP-Server – der
 * Container hört nur auf die Warteschlange in Redis.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: false,
  });
  app.enableShutdownHooks();
  new Logger('Worker').log('Klappe-Worker läuft und wartet auf Transcoding-Jobs.');
}

void bootstrap();
