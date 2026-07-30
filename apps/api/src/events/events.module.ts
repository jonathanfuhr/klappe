import { Global, Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

/**
 * Global, weil fast jeder Dienst etwas zu melden hat – Kommentare, Uploads,
 * Verarbeitung. Ein Modul, das überall importiert werden müsste, hätte hier
 * keinen Erkenntnisgewinn, nur Zeilen.
 */
@Global()
@Module({
  imports: [AccessModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
