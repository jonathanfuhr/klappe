import { Global, Module } from '@nestjs/common';
import { AworkModule } from '../awork/awork.module';
import { QueueModule } from '../queue/queue.module';
import { AccessService } from './access.service';

/**
 * Global, weil praktisch jeder Controller die Sichtbarkeit prüfen muss –
 * eine vergessene Einbindung wäre sonst ein stilles Loch in den Rechten.
 */
@Global()
@Module({
  // Wegen des Hinweises „Gast war zum ersten Mal da" (Phase 28) – der
  // Erstbesuch fällt genau hier auf, beim Vermerken des Zugriffs. Seit
  // Phase 30 geht derselbe Hinweis auch nach awork.
  imports: [QueueModule, AworkModule],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
