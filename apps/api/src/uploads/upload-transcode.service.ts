import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { type UploadRow, uploads } from '../db/schema';
import { StorageService } from '../storage/storage.service';
import type { PlaybackMode } from '../transcode/media-plan';
import type { ProbeResult, TranscodeOutputs } from '../versions/versions.service';

/**
 * Was die Verarbeitung im Zwischenspeicher hinterlässt. Beim Speichern wird
 * daraus die Fassung geschrieben – ohne ffmpeg ein zweites Mal anzuwerfen.
 */
export interface StoredTranscodeResult {
  probe: ProbeResult;
  playbackMode: PlaybackMode;
  playbackReason: string;
  outputs: TranscodeOutputs;
}

/**
 * Die Verarbeitung im Zwischenspeicher (Phase 18).
 *
 * Sobald die Datei vollständig übertragen ist, läuft die Pipeline los – auch
 * wenn Projekt und Video noch fehlen. Das Ergebnis wartet an der
 * Upload-Sitzung, bis jemand speichert; dann zieht alles an seinen Platz.
 *
 * Zwei Ereignisse können in beliebiger Reihenfolge eintreffen: „gespeichert“
 * und „Verarbeitung fertig“. Wer als Zweiter kommt, macht den Umzug. Genau
 * deshalb liegt beides hier zusammen und nicht verstreut in zwei Diensten.
 *
 * `onFinished` wird vom `UploadsService` gesetzt – umgekehrt wäre es ein
 * Kreis: Der Upload-Dienst braucht diesen hier zum Einreihen, dieser den
 * Upload-Dienst zum Aufnehmen.
 */
@Injectable()
export class UploadTranscodeService {
  private readonly logger = new Logger(UploadTranscodeService.name);

  /** Wird nach erfolgreicher Verarbeitung gerufen, wenn ein Ziel feststeht. */
  private onFinished: ((row: UploadRow) => Promise<void>) | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  registerFinishHandler(handler: (row: UploadRow) => Promise<void>): void {
    this.onFinished = handler;
  }

  async getRow(uploadId: string): Promise<UploadRow | null> {
    const [row] = await this.db.select().from(uploads).where(eq(uploads.id, uploadId)).limit(1);
    return row ?? null;
  }

  async setProcessing(uploadId: string): Promise<void> {
    await this.db
      .update(uploads)
      .set({ transcodeStatus: 'PROCESSING', transcodeProgress: 1, transcodeError: null, updatedAt: new Date() })
      .where(eq(uploads.id, uploadId));
  }

  async setProgress(uploadId: string, prozent: number): Promise<void> {
    await this.db
      .update(uploads)
      .set({ transcodeProgress: Math.max(0, Math.min(100, Math.round(prozent))) })
      .where(eq(uploads.id, uploadId));
  }

  async markFailed(uploadId: string, message: string): Promise<void> {
    await this.db
      .update(uploads)
      .set({
        transcodeStatus: 'FAILED',
        transcodeError: message.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(uploads.id, uploadId));
  }

  /**
   * Verarbeitung durch. Steht das Ziel schon fest, wird jetzt aufgenommen –
   * sonst bleibt alles liegen, bis jemand speichert.
   */
  async finish(
    uploadId: string,
    ergebnis: { probe: ProbeResult; decision: { mode: PlaybackMode; reason: string }; outputs: TranscodeOutputs },
  ): Promise<void> {
    const gespeichert: StoredTranscodeResult = {
      probe: ergebnis.probe,
      playbackMode: ergebnis.decision.mode,
      playbackReason: ergebnis.decision.reason,
      outputs: ergebnis.outputs,
    };

    const [row] = await this.db
      .update(uploads)
      .set({
        transcodeStatus: 'READY',
        transcodeProgress: 100,
        transcodeError: null,
        transcodeResult: gespeichert,
        updatedAt: new Date(),
      })
      .where(eq(uploads.id, uploadId))
      .returning();

    if (!row) return;

    // Wurde in der Zwischenzeit gespeichert? Dann jetzt aufnehmen.
    if (row.videoId && row.status !== 'ABORTED' && this.onFinished) {
      await this.onFinished(row);
    }
  }

  /**
   * Sitzungen, deren Verarbeitung ein Neustart unterbrochen hat. Ohne diesen
   * Nachschlag blieben sie für immer bei „wird verarbeitet“ stehen.
   */
  async findStuck(): Promise<UploadRow[]> {
    return this.db
      .select()
      .from(uploads)
      .where(
        and(eq(uploads.transcodeStatus, 'PROCESSING'), eq(uploads.status, 'IN_PROGRESS')),
      );
  }

  /** Das Arbeitsverzeichnis einer Sitzung – zum Aufräumen. */
  async removeWorkDir(uploadId: string): Promise<void> {
    await this.storage.remove(this.storage.keyForUploadWorkDir(uploadId));
  }

  /** Liest das gespeicherte Ergebnis, sofern es eines gibt. */
  result(row: UploadRow): StoredTranscodeResult | null {
    if (row.transcodeStatus !== 'READY' || !row.transcodeResult) return null;
    return row.transcodeResult as StoredTranscodeResult;
  }
}
