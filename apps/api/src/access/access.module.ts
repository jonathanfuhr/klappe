import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';

/**
 * Global, weil praktisch jeder Controller die Sichtbarkeit prüfen muss –
 * eine vergessene Einbindung wäre sonst ein stilles Loch in den Rechten.
 */
@Global()
@Module({
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
