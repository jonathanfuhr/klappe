import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { type FileHandle, open } from 'node:fs/promises';
import { AppConfig, CONFIG } from '../config/configuration';
import { TRANSCODE_QUEUE, type TranscodeJobData } from '../queue/queue.constants';
import { StorageService } from '../storage/storage.service';
import { UploadTranscodeService } from '../uploads/upload-transcode.service';
import { VersionsService, type TranscodeOutputs } from '../versions/versions.service';
import { FfmpegService } from './ffmpeg.service';
import { SEGMENT_SECONDS, planLadder } from './hls-plan';
import { type PlaybackDecision, decidePlayback, planPosterTime, planProxyScale, planSprite } from './media-plan';
import { readTopLevelBoxes } from './mp4-faststart';
import type { ProbeResult } from '../versions/versions.service';

/** Wohin die Ergebnisse geschrieben werden – Schlüssel je Erzeugnis. */
export interface TranscodeKeys {
  proxy: string;
  poster: string;
  sprite: string;
  hls: string;
}

export interface PipelineResult {
  probe: ProbeResult;
  decision: PlaybackDecision;
  outputs: TranscodeOutputs;
}

/**
 * Die Pipeline aus Phase 2: Metadaten lesen, Abspielfassung bereitstellen,
 * Posterframe und Sprite-Streifen erzeugen.
 *
 * Nicht jede Datei muss neu kodiert werden. Ein fertiges 1080p-H.264-MP4
 * durch x264 zu schicken kostet Minuten und Qualität, ohne dass jemand etwas
 * davon hat. Deshalb wird zuerst geprüft, was die Datei überhaupt braucht:
 * gar nichts, ein Neu-Verpacken in Sekunden, oder den vollen Durchlauf.
 *
 * Die Nebenwege (Poster, Sprite) dürfen scheitern, ohne die Version als
 * fehlgeschlagen zu markieren – ohne Abspielfassung geht dagegen gar nichts.
 *
 * Seit Phase 18 gibt es zwei Wege hierher: eine fertige Fassung – oder eine
 * Datei, die noch im Zwischenspeicher liegt, weil beim Hochladen noch niemand
 * Projekt und Video eingetragen hat. Der Ablauf ist derselbe, nur die Ablage
 * unterscheidet sich; deshalb steckt er in `runPipeline` und nicht im
 * Job-Handler.
 *
 * Die Nebenläufigkeit steht im Decorator und wird deshalb direkt aus der
 * Umgebung gelesen; Decorator-Argumente stehen vor der Dependency Injection fest.
 */
@Processor(TRANSCODE_QUEUE, {
  concurrency: Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 1) || 1),
})
export class TranscodeProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscodeProcessor.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly versionsService: VersionsService,
    private readonly uploadTranscode: UploadTranscodeService,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
  ) {
    super();
  }

  async process(job: Job<TranscodeJobData>): Promise<void> {
    if ('uploadId' in job.data) {
      await this.processUpload(job, job.data.uploadId);
      return;
    }
    await this.processVersion(job, job.data.versionId);
  }

  // ---------- Weg 1: eine Fassung, die schon existiert ----------

  private async processVersion(job: Job<TranscodeJobData>, versionId: string): Promise<void> {
    const version = await this.versionsService.getRowOrFail(versionId);

    if (!version.originalKey) {
      await this.versionsService.markFailed(versionId, 'Es liegt keine hochgeladene Datei vor.');
      return;
    }

    const keys: TranscodeKeys = {
      proxy: this.storage.keyForProxy(versionId),
      poster: this.storage.keyForPoster(versionId),
      sprite: this.storage.keyForSprite(versionId),
      hls: this.storage.keyForHlsDir(versionId),
    };

    this.logger.log(`Verarbeitung gestartet: ${version.originalFilename} (${versionId})`);

    try {
      await this.versionsService.setStatus(versionId, 'PROCESSING');
      await this.versionsService.setProgress(versionId, 1);

      const ergebnis = await this.runPipeline({
        label: versionId,
        originalKey: version.originalKey,
        keys,
        onProbe: (probe) => this.versionsService.applyProbe(versionId, probe),
        onDecision: (entscheidung) =>
          this.versionsService.setPlaybackDecision(versionId, entscheidung.mode, entscheidung.reason),
        onProgress: async (prozent) => {
          await this.versionsService.setProgress(versionId, prozent);
          await job.updateProgress(Math.round(prozent));
        },
      });

      await this.versionsService.markReady(versionId, ergebnis.outputs);
      this.logger.log(`Verarbeitung fertig: ${version.originalFilename} (${versionId})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Verarbeitung fehlgeschlagen (${versionId}): ${message}`);
      await this.raeumeAuf(keys);
      await this.versionsService.markFailed(versionId, message);
      throw error;
    }
  }

  // ---------- Weg 2: eine Datei im Zwischenspeicher (Phase 18) ----------

  private async processUpload(job: Job<TranscodeJobData>, uploadId: string): Promise<void> {
    const row = await this.uploadTranscode.getRow(uploadId);
    if (!row) {
      this.logger.warn(`Upload ${uploadId} existiert nicht mehr – nichts zu verarbeiten.`);
      return;
    }
    if (row.status === 'ABORTED') return;

    const arbeit = this.storage.keyForUploadWorkDir(uploadId);
    const keys: TranscodeKeys = {
      proxy: `${arbeit}/proxy.mp4`,
      poster: `${arbeit}/poster.jpg`,
      sprite: `${arbeit}/sprite.jpg`,
      hls: `${arbeit}/hls`,
    };

    this.logger.log(`Verarbeitung im Zwischenspeicher gestartet: ${row.filename} (${uploadId})`);

    try {
      await this.uploadTranscode.setProcessing(uploadId);

      const ergebnis = await this.runPipeline({
        label: uploadId,
        originalKey: row.storageKey,
        keys,
        onProbe: async () => undefined,
        onDecision: async () => undefined,
        onProgress: async (prozent) => {
          await this.uploadTranscode.setProgress(uploadId, prozent);
          await job.updateProgress(Math.round(prozent));
        },
      });

      // Fertig – und jetzt entscheidet sich, ob schon jemand gespeichert hat.
      // Falls ja, wandert alles sofort an seinen Platz; falls nein, wartet es
      // hier, bis der Speichern-Knopf kommt.
      await this.uploadTranscode.finish(uploadId, ergebnis);
      this.logger.log(`Verarbeitung im Zwischenspeicher fertig: ${row.filename} (${uploadId})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Verarbeitung fehlgeschlagen (Upload ${uploadId}): ${message}`);
      await this.raeumeAuf(keys);
      await this.uploadTranscode.markFailed(uploadId, message);
      throw error;
    }
  }

  // ---------- Der gemeinsame Ablauf ----------

  private async runPipeline(input: {
    /** Nur fürs Log – Versions- oder Upload-Kennung. */
    label: string;
    originalKey: string;
    keys: TranscodeKeys;
    onProbe: (probe: ProbeResult) => Promise<void>;
    onDecision: (decision: PlaybackDecision) => Promise<void>;
    onProgress: (prozent: number) => Promise<void>;
  }): Promise<PipelineResult> {
    const originalPath = this.storage.resolveKey(input.originalKey);
    await input.onProgress(1);

    const probe = await this.ffmpeg.probe(originalPath);
    await input.onProbe(probe);

    if (!probe.width || !probe.height) {
      throw new Error('Die Datei enthält keine auswertbare Videospur.');
    }

    const decision = decidePlayback(
      {
        videoCodec: probe.videoCodec,
        audioCodec: probe.audioCodec,
        pixelFormat: probe.pixelFormat,
        formatName: probe.formatName,
        width: probe.width,
        height: probe.height,
        bitrateBps: probe.bitrateBps,
        fastStart: await this.hasFastStart(originalPath),
      },
      {
        maxShortEdge: this.config.transcode.proxyShortEdge,
        maxBitrateBps: this.config.transcode.playbackMaxBitrateBps,
      },
    );
    this.logger.log(`Abspielfassung (${input.label}): ${decision.mode} – ${decision.reason}`);
    await input.onDecision(decision);

    const playback = await this.preparePlayback({
      decision,
      originalKey: input.originalKey,
      originalPath,
      proxyKey: input.keys.proxy,
      probe,
      // Der Proxy ist der lange Teil; Poster und Sprite bekommen den Rest.
      onProgress: (fraction) => void input.onProgress(5 + fraction * 80),
    });

    await input.onProgress(88);

    const outputs: TranscodeOutputs = {
      proxyKey: playback.key,
      proxyWidth: playback.width,
      proxyHeight: playback.height,
      proxySizeBytes: await this.storage.size(playback.key),
      posterKey: null,
      sprite: null,
      hlsKey: null,
      hlsVariants: null,
    };

    // Poster und Sprite entstehen aus der Abspielfassung statt aus dem
    // Original: Das ist um ein Vielfaches schneller als ein zweiter
    // 4K-Durchlauf.
    const playbackPath = this.storage.resolveKey(playback.key);

    try {
      await this.storage.ensureDirForKey(input.keys.poster);
      await this.ffmpeg.createPoster({
        inputPath: playbackPath,
        outputPath: this.storage.resolveKey(input.keys.poster),
        atSeconds: planPosterTime(probe.durationSeconds),
        height: this.config.transcode.posterHeight,
      });
      outputs.posterKey = input.keys.poster;
    } catch (error) {
      this.logger.warn(`Posterframe fehlgeschlagen (${input.label}): ${String(error)}`);
    }

    await input.onProgress(93);

    const spritePlan = planSprite({
      durationSeconds: probe.durationSeconds ?? 0,
      sourceWidth: playback.width,
      sourceHeight: playback.height,
      tileWidth: this.config.transcode.spriteTileWidth,
      columns: this.config.transcode.spriteColumns,
      maxTiles: this.config.transcode.spriteMaxTiles,
    });

    if (spritePlan) {
      try {
        await this.storage.ensureDirForKey(input.keys.sprite);
        await this.ffmpeg.createSprite({
          inputPath: playbackPath,
          outputPath: this.storage.resolveKey(input.keys.sprite),
          plan: spritePlan,
        });
        outputs.sprite = { key: input.keys.sprite, ...spritePlan };
      } catch (error) {
        this.logger.warn(`Sprite-Streifen fehlgeschlagen (${input.label}): ${String(error)}`);
      }
    }

    // Die HLS-Leiter ist die Ausbaustufe aus dem Konzept: ein weiterer
    // Durchlauf, deshalb nur auf ausdrücklichen Wunsch. Der progressive
    // Proxy bleibt in jedem Fall die Grundlage fürs frame-genaue Arbeiten.
    if (this.config.transcode.hlsEnabled) {
      const rungs = planLadder(probe.width ?? 0, probe.height ?? 0);
      if (rungs.length > 0) {
        try {
          await this.storage.ensureDirForKey(`${input.keys.hls}/master.m3u8`);
          for (const rung of rungs) {
            await this.storage.ensureDirForKey(`${input.keys.hls}/${rung.name}/index.m3u8`);
          }

          await this.ffmpeg.createHlsLadder({
            inputPath: originalPath,
            outputDir: this.storage.resolveKey(input.keys.hls),
            rungs,
            frameRate: probe.frameRate,
            durationSeconds: probe.durationSeconds,
            segmentSeconds: this.config.transcode.hlsSegmentSeconds || SEGMENT_SECONDS,
          });

          outputs.hlsKey = input.keys.hls;
          outputs.hlsVariants = rungs.map((rung) => rung.name).join(',');
          this.logger.log(`HLS-Leiter erzeugt (${input.label}): ${outputs.hlsVariants}`);
        } catch (error) {
          // Wie Poster und Sprite: ein Nebenweg, der scheitern darf.
          this.logger.warn(`HLS-Leiter fehlgeschlagen (${input.label}): ${String(error)}`);
          await this.storage.remove(input.keys.hls);
        }
      }
    }

    return { probe, decision, outputs };
  }

  /** Halbfertige Ausgaben wegräumen, damit ein neuer Versuch sauber startet. */
  private async raeumeAuf(keys: TranscodeKeys): Promise<void> {
    await this.storage.remove(keys.proxy);
    await this.storage.remove(keys.poster);
    await this.storage.remove(keys.sprite);
    await this.storage.remove(keys.hls);
  }

  /**
   * Stellt die Abspielfassung bereit und gibt zurück, wo sie liegt und wie
   * groß sie ist.
   */
  private async preparePlayback(input: {
    decision: PlaybackDecision;
    originalKey: string;
    originalPath: string;
    proxyKey: string;
    probe: { width: number | null; height: number | null; frameRate: { num: number; den: number } | null; durationSeconds: number | null };
    onProgress: (fraction: number) => void;
  }): Promise<{ key: string; width: number; height: number }> {
    const width = input.probe.width ?? 0;
    const height = input.probe.height ?? 0;

    if (input.decision.mode === 'ORIGINAL') {
      // Nichts anfassen: Der Player bekommt die Originaldatei.
      return { key: input.originalKey, width, height };
    }

    await this.storage.ensureDirForKey(input.proxyKey);

    if (input.decision.mode === 'REMUX') {
      await this.ffmpeg.remux({
        inputPath: input.originalPath,
        outputPath: this.storage.resolveKey(input.proxyKey),
      });
      return { key: input.proxyKey, width, height };
    }

    const scale = planProxyScale(width, height, this.config.transcode.proxyShortEdge);
    await this.ffmpeg.createProxy({
      inputPath: input.originalPath,
      outputPath: this.storage.resolveKey(input.proxyKey),
      width: scale.width,
      height: scale.height,
      frameRate: input.probe.frameRate,
      durationSeconds: input.probe.durationSeconds,
      onProgress: input.onProgress,
    });
    return { key: input.proxyKey, width: scale.width, height: scale.height };
  }

  /** Liegt der MP4-Index schon vorn? Bei Fehlern gilt: lieber neu verpacken. */
  private async hasFastStart(path: string): Promise<boolean> {
    let handle: FileHandle | undefined;
    try {
      const opened = await open(path, 'r');
      handle = opened;
      const stat = await opened.stat();
      const result = await readTopLevelBoxes(async (offset, length) => {
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await opened.read(buffer, 0, length, offset);
        return buffer.subarray(0, bytesRead);
      }, stat.size);
      return result.fastStart;
    } catch {
      return false;
    } finally {
      await handle?.close();
    }
  }
}
