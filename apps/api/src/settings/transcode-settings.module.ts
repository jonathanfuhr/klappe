import { Global, Module } from '@nestjs/common';
import { TranscodeSettingsService } from './transcode-settings.service';

/**
 * Die Verarbeitungseinstellungen (Phase 19) werden an vielen Stellen
 * gebraucht: beim Einreihen einer Fassung, im Worker vor jedem Auftrag, im
 * Download-Fenster und natürlich in den Einstellungen selbst. Deshalb global –
 * wie Ablage, Rechte und Ereignisse.
 */
@Global()
@Module({
  providers: [TranscodeSettingsService],
  exports: [TranscodeSettingsService],
})
export class TranscodeSettingsModule {}
