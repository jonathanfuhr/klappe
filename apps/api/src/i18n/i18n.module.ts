import { Global, Module } from '@nestjs/common';
import { LocaleService } from './locale.service';

/**
 * Der Sprach-Dienst wird an mehreren Stellen gebraucht – im Fehlerfilter, beim
 * Mailversand – und ist deshalb global (Phase 26).
 */
@Global()
@Module({
  providers: [LocaleService],
  exports: [LocaleService],
})
export class I18nModule {}
