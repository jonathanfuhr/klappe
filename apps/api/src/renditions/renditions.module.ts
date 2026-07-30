import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { AftercareService } from './aftercare.service';
import { RenditionsController } from './renditions.controller';
import { RenditionsService } from './renditions.service';

/**
 * Download in verschiedenen Formaten (Phase 19).
 *
 * Der Controller läuft nur in der API, der Dienst auch im Worker – deshalb
 * beides hier und die Registrierung getrennt (`AppModule` bzw.
 * `TranscodeModule`).
 */
@Module({
  imports: [QueueModule],
  controllers: [RenditionsController],
  providers: [RenditionsService, AftercareService],
  exports: [RenditionsService, AftercareService],
})
export class RenditionsModule {}
