import { Global, Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { AccessService } from './access.service';

/**
 * Global, weil praktisch jeder Controller die Sichtbarkeit prüfen muss –
 * eine vergessene Einbindung wäre sonst ein stilles Loch in den Rechten.
 */
@Global()
@Module({
  // Wegen des Hinweises „Gast war zum ersten Mal da" (Phase 28) – der
  // Erstbesuch fällt genau hier auf, beim Vermerken des Zugriffs.
  imports: [QueueModule],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
