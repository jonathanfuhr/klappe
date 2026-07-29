import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { type FileHandle, open } from 'node:fs/promises';
import { AppConfig, CONFIG } from '../config/configuration';
import { TRANSCODE_QUEUE, type TranscodeJobData } from '../queue/queue.constants';
import { AftercareService } from '../renditions/aftercare.service';
import { RenditionsService } from '../renditions/renditions.service';
import {
  TranscodeSettingsService,
  type EffectiveTranscode,
} from '../settings/transcode-settings.service';
import { StorageService } from '../storage/storage.service';
import { UploadTranscodeService } from '../uploads/upload-transcode.service';
import { VersionsService, type TranscodeOutputs } from '../versions/versions.service';
import { FfmpegService } from './ffmpeg.service';
import { SEGMENT_SECONDS, planLadder } from './hls-plan';
import { type PlaybackDecision, decidePlayback, planPosterTime, planProxyScale, planSprite } from './media-plan';
import { readTopLevelBoxes } from './mp4-faststart';
import { planRendition } from './rendition-plan';
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
 * Seit Phase 19 kommen zwei Nacharbeiten dazu, die *nicht* mehr in diesem
 * Durchgang stecken: die HLS-Stufenleiter und die Download-Formate. Beide
 * hielten die Fassung nur auf – abspielbar ist sie mit dem Proxy. Sie laufen
 * jetzt als eigene Aufträge mit niedrigem Vorrang.
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
    private readonly settings: TranscodeSettingsService,
    private readonly renditions: RenditionsService,
    private readonly aftercare: AftercareService,
  ) {
    super();
  }

  async process(job: Job<TranscodeJobData>): Promise<void> {
    if ('uploadId' in job.data) {
      await this.processUpload(job, job.data.uploadId);
      return;
    }
    if ('hlsVersionId' in job.data) {
      await this.processHls(job, job.data.hlsVersionId);
      return;
    }
    if ('renditionId' in job.data) {
      await this.processRendition(job, job.data.renditionId);
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
      // HLS-Leiter und Download-Formate erst danach – die Fassung ist ab
      // jetzt abspielbar und soll darauf nicht warten (Phase 19).
      await this.aftercare.scheduleQuietly(versionId);
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

  // ---------- Weg 3: die HLS-Stufenleiter (Phase 19) ----------

  /**
   * Die adaptive Wiedergabe als eigener Auftrag. Sie kostet einen weiteren
   * vollen Durchlauf über das Original – deshalb hinten in der Schlange und,
   * wenn ein Zeitfenster gesetzt ist, erst darin.
   *
   * Scheitert sie, bleibt die Fassung fertig: Der progressive Proxy trägt das
   * Abspielen ohnehin allein.
   */
  private async processHls(job: Job<TranscodeJobData>, versionId: string): Promise<void> {
    const version = await this.versionsService.getRowOrFail(versionId);
    if (version.status !== 'READY' || !version.originalKey) return;
    if (version.hlsKey) return;

    const einstellungen = await this.settings.effective();
    if (!einstellungen.hlsEnabled) {
      this.logger.log(`HLS-Leiter übersprungen (${versionId}): inzwischen abgeschaltet.`);
      return;
    }

    const rungs = planLadder(version.width ?? 0, version.height ?? 0);
    if (rungs.length === 0) return;

    const key = this.storage.keyForHlsDir(versionId);
    this.logger.log(`HLS-Leiter gestartet: ${version.originalFilename} (${versionId})`);

    try {
      await this.storage.ensureDirForKey(`${key}/master.m3u8`);
      for (const rung of rungs) {
        await this.storage.ensureDirForKey(`${key}/${rung.name}/index.m3u8`);
      }

      await this.ffmpeg.createHlsLadder({
        inputPath: this.storage.resolveKey(version.originalKey),
        outputDir: this.storage.resolveKey(key),
        rungs,
        frameRate:
          version.fpsNum && version.fpsDen ? { num: version.fpsNum, den: version.fpsDen } : null,
        durationSeconds: version.durationSeconds,
        segmentSeconds: this.config.transcode.hlsSegmentSeconds || SEGMENT_SECONDS,
        preset: einstellungen.proxyPreset,
        onProgress: (anteil) => void job.updateProgress(Math.round(anteil * 100)),
      });

      await this.versionsService.setHls(versionId, key, rungs.map((rung) => rung.name).join(','));
      this.logger.log(`HLS-Leiter fertig (${versionId}): ${rungs.map((r) => r.name).join(', ')}`);
    } catch (error) {
      // Ein Nebenweg, der scheitern darf – die Fassung bleibt fertig.
      this.logger.warn(`HLS-Leiter fehlgeschlagen (${versionId}): ${String(error)}`);
      await this.storage.remove(key);
    }
  }

  // ---------- Weg 4: eine Download-Fassung (Phase 19) ----------

  private async processRendition(job: Job<TranscodeJobData>, renditionId: string): Promise<void> {
    const auftrag = await this.renditions.loadJob(renditionId);
    if (!auftrag) {
      this.logger.warn(`Download-Fassung ${renditionId} existiert nicht mehr.`);
      return;
    }

    const { rendition, preset, version } = auftrag;
    if (rendition.status === 'READY') return;
    if (version.status !== 'READY' || !version.originalKey) {
      await this.renditions.markFailed(renditionId, 'Die Fassung ist nicht (mehr) verarbeitet.');
      return;
    }
    if (!version.width || !version.height) {
      await this.renditions.markFailed(renditionId, 'Die Auflösung des Originals ist unbekannt.');
      return;
    }

    const plan = planRendition(version.width, version.height, preset);
    const key = this.storage.keyForRendition(version.id, rendition.id, plan.container);

    this.logger.log(
      `Download-Fassung gestartet: ${preset.name} für ${version.originalFilename} ` +
        `(${plan.width}×${plan.height}, ${plan.videoBitrateKbps} kbit/s)`,
    );

    try {
      await this.renditions.setProcessing(renditionId);
      await this.storage.ensureDirForKey(key);

      await this.ffmpeg.createRendition({
        inputPath: this.storage.resolveKey(version.originalKey),
        outputPath: this.storage.resolveKey(key),
        width: plan.width,
        height: plan.height,
        videoBitrateKbps: plan.videoBitrateKbps,
        audioBitrateKbps: plan.audioBitrateKbps,
        preset: plan.preset,
        frameRate:
          version.fpsNum && version.fpsDen ? { num: version.fpsNum, den: version.fpsDen } : null,
        durationSeconds: version.durationSeconds,
        onProgress: async (anteil) => {
          await this.renditions.setProgress(renditionId, anteil * 100);
          await job.updateProgress(Math.round(anteil * 100));
        },
      });

      await this.renditions.finish(renditionId, {
        storageKey: key,
        sizeBytes: await this.storage.size(key),
        width: plan.width,
        height: plan.height,
      });
      this.logger.log(`Download-Fassung fertig: ${preset.name} (${renditionId})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Download-Fassung fehlgeschlagen (${renditionId}): ${message}`);
      await this.storage.remove(key);
      await this.renditions.markFailed(renditionId, message);
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

    // Frisch aus der Datenbank, nicht beim Start eingelesen: Eine Änderung in
    // den Einstellungen greift damit ab dem nächsten Auftrag, ohne dass der
    // Container neu starten muss (Phase 19).
    const einstellungen = await this.settings.effective();

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
        maxShortEdge: einstellungen.proxyShortEdge,
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
      einstellungen,
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

    // Die HLS-Leiter entsteht seit Phase 19 nicht mehr hier, sondern als
    // eigener Auftrag: Sie kostet einen zweiten vollen Durchlauf über das
    // Original und hielt die Fassung nur auf, die mit dem Proxy längst
    // abspielbar ist. Siehe `processHls`.
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
    einstellungen: EffectiveTranscode;
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

    const scale = planProxyScale(width, height, input.einstellungen.proxyShortEdge);
    await this.ffmpeg.createProxy({
      inputPath: input.originalPath,
      outputPath: this.storage.resolveKey(input.proxyKey),
      width: scale.width,
      height: scale.height,
      frameRate: input.probe.frameRate,
      durationSeconds: input.probe.durationSeconds,
      encoding: {
        preset: input.einstellungen.proxyPreset,
        videoBitrate: input.einstellungen.proxyVideoBitrate,
        maxrate: input.einstellungen.proxyMaxrate,
        bufsize: input.einstellungen.proxyBufsize,
      },
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
