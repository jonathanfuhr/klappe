import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AppConfig, CONFIG } from '../config/configuration';
import { TRANSCODE_QUEUE, type TranscodeJobData } from '../queue/queue.constants';
import { StorageService } from '../storage/storage.service';
import { VersionsService, type TranscodeOutputs } from '../versions/versions.service';
import { FfmpegService } from './ffmpeg.service';
import { planPosterTime, planProxyScale, planSprite } from './media-plan';

/**
 * Die Pipeline aus Phase 2: Metadaten lesen, Proxy bauen, Posterframe und
 * Sprite-Streifen erzeugen.
 *
 * Die Nebenwege (Poster, Sprite) dürfen scheitern, ohne die Version als
 * fehlgeschlagen zu markieren – ohne Proxy geht dagegen gar nichts.
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
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
  ) {
    super();
  }

  async process(job: Job<TranscodeJobData>): Promise<void> {
    const { versionId } = job.data;
    const version = await this.versionsService.getRowOrFail(versionId);

    if (!version.originalKey) {
      await this.versionsService.markFailed(versionId, 'Es liegt keine hochgeladene Datei vor.');
      return;
    }

    const originalPath = this.storage.resolveKey(version.originalKey);
    const proxyKey = this.storage.keyForProxy(versionId);
    const posterKey = this.storage.keyForPoster(versionId);
    const spriteKey = this.storage.keyForSprite(versionId);

    this.logger.log(`Transcoding gestartet: ${version.originalFilename} (${versionId})`);

    try {
      await this.versionsService.setStatus(versionId, 'PROCESSING');
      await this.versionsService.setProgress(versionId, 1);

      const probe = await this.ffmpeg.probe(originalPath);
      await this.versionsService.applyProbe(versionId, probe);

      if (!probe.width || !probe.height) {
        throw new Error('Die Datei enthält keine auswertbare Videospur.');
      }

      const scale = planProxyScale(probe.width, probe.height, this.config.transcode.proxyHeight);

      await this.storage.ensureDirForKey(proxyKey);
      await this.ffmpeg.createProxy({
        inputPath: originalPath,
        outputPath: this.storage.resolveKey(proxyKey),
        width: scale.width,
        height: scale.height,
        frameRate: probe.frameRate,
        durationSeconds: probe.durationSeconds,
        onProgress: (fraction) => {
          // Der Proxy ist der lange Teil; Poster und Sprite bekommen den Rest.
          void this.versionsService.setProgress(versionId, 5 + fraction * 80);
          void job.updateProgress(Math.round(5 + fraction * 80));
        },
      });

      await this.versionsService.setProgress(versionId, 88);

      const outputs: TranscodeOutputs = {
        proxyKey,
        proxyWidth: scale.width,
        proxyHeight: scale.height,
        proxySizeBytes: await this.storage.size(proxyKey),
        posterKey: null,
        sprite: null,
      };

      // Poster und Sprite entstehen aus dem Proxy statt aus dem Original:
      // Das ist um ein Vielfaches schneller als ein zweiter 4K-Durchlauf.
      const proxyPath = this.storage.resolveKey(proxyKey);

      try {
        await this.storage.ensureDirForKey(posterKey);
        await this.ffmpeg.createPoster({
          inputPath: proxyPath,
          outputPath: this.storage.resolveKey(posterKey),
          atSeconds: planPosterTime(probe.durationSeconds),
          height: this.config.transcode.posterHeight,
        });
        outputs.posterKey = posterKey;
      } catch (error) {
        this.logger.warn(`Posterframe fehlgeschlagen (${versionId}): ${String(error)}`);
      }

      await this.versionsService.setProgress(versionId, 93);

      const spritePlan = planSprite({
        durationSeconds: probe.durationSeconds ?? 0,
        sourceWidth: scale.width,
        sourceHeight: scale.height,
        tileWidth: this.config.transcode.spriteTileWidth,
        columns: this.config.transcode.spriteColumns,
        maxTiles: this.config.transcode.spriteMaxTiles,
      });

      if (spritePlan) {
        try {
          await this.storage.ensureDirForKey(spriteKey);
          await this.ffmpeg.createSprite({
            inputPath: proxyPath,
            outputPath: this.storage.resolveKey(spriteKey),
            plan: spritePlan,
          });
          outputs.sprite = { key: spriteKey, ...spritePlan };
        } catch (error) {
          this.logger.warn(`Sprite-Streifen fehlgeschlagen (${versionId}): ${String(error)}`);
        }
      }

      await this.versionsService.markReady(versionId, outputs);
      this.logger.log(`Transcoding fertig: ${version.originalFilename} (${versionId})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Transcoding fehlgeschlagen (${versionId}): ${message}`);

      // Halbfertige Ausgaben wegräumen, damit ein neuer Versuch sauber startet.
      await this.storage.remove(proxyKey);
      await this.storage.remove(posterKey);
      await this.storage.remove(spriteKey);

      await this.versionsService.markFailed(versionId, message);
      throw error;
    }
  }
}
