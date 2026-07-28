import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { type FileHandle, open } from 'node:fs/promises';
import { AppConfig, CONFIG } from '../config/configuration';
import { TRANSCODE_QUEUE, type TranscodeJobData } from '../queue/queue.constants';
import { StorageService } from '../storage/storage.service';
import { VersionsService, type TranscodeOutputs } from '../versions/versions.service';
import { FfmpegService } from './ffmpeg.service';
import { SEGMENT_SECONDS, planLadder } from './hls-plan';
import { type PlaybackDecision, decidePlayback, planPosterTime, planProxyScale, planSprite } from './media-plan';
import { readTopLevelBoxes } from './mp4-faststart';

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
    const hlsKey = this.storage.keyForHlsDir(versionId);

    this.logger.log(`Verarbeitung gestartet: ${version.originalFilename} (${versionId})`);

    try {
      await this.versionsService.setStatus(versionId, 'PROCESSING');
      await this.versionsService.setProgress(versionId, 1);

      const probe = await this.ffmpeg.probe(originalPath);
      await this.versionsService.applyProbe(versionId, probe);

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
      this.logger.log(`Abspielfassung (${versionId}): ${decision.mode} – ${decision.reason}`);
      await this.versionsService.setPlaybackDecision(versionId, decision.mode, decision.reason);

      const playback = await this.preparePlayback({
        decision,
        versionId,
        originalKey: version.originalKey,
        originalPath,
        proxyKey,
        probe,
        onProgress: (fraction) => {
          // Der Proxy ist der lange Teil; Poster und Sprite bekommen den Rest.
          void this.versionsService.setProgress(versionId, 5 + fraction * 80);
          void job.updateProgress(Math.round(5 + fraction * 80));
        },
      });

      await this.versionsService.setProgress(versionId, 88);

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
        await this.storage.ensureDirForKey(posterKey);
        await this.ffmpeg.createPoster({
          inputPath: playbackPath,
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
        sourceWidth: playback.width,
        sourceHeight: playback.height,
        tileWidth: this.config.transcode.spriteTileWidth,
        columns: this.config.transcode.spriteColumns,
        maxTiles: this.config.transcode.spriteMaxTiles,
      });

      if (spritePlan) {
        try {
          await this.storage.ensureDirForKey(spriteKey);
          await this.ffmpeg.createSprite({
            inputPath: playbackPath,
            outputPath: this.storage.resolveKey(spriteKey),
            plan: spritePlan,
          });
          outputs.sprite = { key: spriteKey, ...spritePlan };
        } catch (error) {
          this.logger.warn(`Sprite-Streifen fehlgeschlagen (${versionId}): ${String(error)}`);
        }
      }

      // Die HLS-Leiter ist die Ausbaustufe aus dem Konzept: ein weiterer
      // Durchlauf, deshalb nur auf ausdrücklichen Wunsch. Der progressive
      // Proxy bleibt in jedem Fall die Grundlage fürs frame-genaue Arbeiten.
      if (this.config.transcode.hlsEnabled) {
        const rungs = planLadder(probe.width ?? 0, probe.height ?? 0);
        if (rungs.length > 0) {
          try {
            await this.storage.ensureDirForKey(`${hlsKey}/master.m3u8`);
            for (const rung of rungs) {
              await this.storage.ensureDirForKey(`${hlsKey}/${rung.name}/index.m3u8`);
            }

            await this.ffmpeg.createHlsLadder({
              inputPath: originalPath,
              outputDir: this.storage.resolveKey(hlsKey),
              rungs,
              frameRate: probe.frameRate,
              durationSeconds: probe.durationSeconds,
              segmentSeconds: this.config.transcode.hlsSegmentSeconds || SEGMENT_SECONDS,
            });

            outputs.hlsKey = hlsKey;
            outputs.hlsVariants = rungs.map((rung) => rung.name).join(',');
            this.logger.log(`HLS-Leiter erzeugt (${versionId}): ${outputs.hlsVariants}`);
          } catch (error) {
            // Wie Poster und Sprite: ein Nebenweg, der scheitern darf.
            this.logger.warn(`HLS-Leiter fehlgeschlagen (${versionId}): ${String(error)}`);
            await this.storage.remove(hlsKey);
          }
        }
      }

      await this.versionsService.markReady(versionId, outputs);
      this.logger.log(`Verarbeitung fertig: ${version.originalFilename} (${versionId})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Verarbeitung fehlgeschlagen (${versionId}): ${message}`);

      // Halbfertige Ausgaben wegräumen, damit ein neuer Versuch sauber startet.
      await this.storage.remove(proxyKey);
      await this.storage.remove(posterKey);
      await this.storage.remove(spriteKey);
      await this.storage.remove(hlsKey);

      await this.versionsService.markFailed(versionId, message);
      throw error;
    }
  }

  /**
   * Stellt die Abspielfassung bereit und gibt zurück, wo sie liegt und wie
   * groß sie ist.
   */
  private async preparePlayback(input: {
    decision: PlaybackDecision;
    versionId: string;
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
