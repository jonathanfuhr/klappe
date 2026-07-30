import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { spawn } from 'node:child_process';
import type { FrameRate } from '@klappe/shared';
import { AppConfig, CONFIG } from '../config/configuration';
import { decodeArgs, keyframeArgs, videoEncodeArgs } from './encoder-args';
import { type FfprobeOutput, parseProbeOutput } from './ffprobe-parse';
import type { ProbeResult } from '../versions/versions.service';
import type { LadderRung } from './hls-plan';
import type { SpritePlan } from './media-plan';

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderrTail: string,
  ) {
    super(message);
    this.name = 'FfmpegError';
  }
}

interface RunOptions {
  /** Laufzeit des Quellmaterials, um aus `-progress` Prozent zu machen. */
  totalSeconds?: number;
  onProgress?: (fraction: number) => void;
}

@Injectable()
export class FfmpegService implements OnModuleInit {
  private readonly logger = new Logger(FfmpegService.name);

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /**
   * Beim Start einmal nachsehen, ob das konfigurierte ffmpeg den gewählten
   * Encoder überhaupt mitbringt. Ohne diese Probe fiele eine Fehlkonfiguration
   * – etwa `VIDEO_ENCODER=h264_videotoolbox` in einem Container, wo es kein
   * VideoToolbox gibt – erst beim ersten Auftrag auf. So endet der Prozess
   * sofort mit einer verständlichen Meldung. Das Transcode-Modul lädt nur der
   * Worker; die API bleibt von diesem Aufruf unberührt. Nebenbei entlarvt der
   * Check auch einen kaputten FFMPEG_PATH, noch bevor Aufträge scheitern.
   */
  async onModuleInit(): Promise<void> {
    const { ffmpegPath, videoEncoder } = this.config.transcode;
    const { stdout } = await this.run(ffmpegPath, ['-hide_banner', '-encoders'], {});
    const vorhanden = stdout
      .split('\n')
      .some((zeile) => new RegExp(`^\\s*V\\S*\\s+${videoEncoder}\\s`).test(zeile));
    if (!vorhanden) {
      throw new Error(
        `Der Video-Encoder "${videoEncoder}" fehlt in ${ffmpegPath}. ` +
          `VideoToolbox gibt es nur für einen nativ auf macOS laufenden Worker ` +
          `(brew install ffmpeg, siehe docs/apple-silicon.md); ohne Hardware gilt ` +
          `VIDEO_ENCODER=libx264 (Standard).`,
      );
    }
    this.logger.log(`Video-Encoder: ${videoEncoder} (${ffmpegPath})`);
  }

  async probe(inputPath: string): Promise<ProbeResult> {
    const { stdout } = await this.run(
      this.config.transcode.ffprobePath,
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        inputPath,
      ],
      {},
    );

    let parsed: FfprobeOutput;
    try {
      parsed = JSON.parse(stdout) as FfprobeOutput;
    } catch {
      throw new FfmpegError('ffprobe lieferte keine lesbare Ausgabe.', 0, stdout.slice(-2000));
    }
    return parseProbeOutput(parsed);
  }

  /**
   * 1080p-H.264-Proxy fürs Abspielen im Browser.
   *
   * Die Framerate wird bewusst 1:1 übernommen und der Ausgabestrom auf CFR
   * gezwungen: Nur dann entspricht Frame N im Proxy exakt Frame N im
   * Original – und genau darauf beruhen Frame-Counter und Kommentare.
   */
  async createProxy(input: {
    inputPath: string;
    outputPath: string;
    width: number;
    height: number;
    frameRate: FrameRate | null;
    durationSeconds: number | null;
    /**
     * Kodierwerte aus den Einstellungen (Phase 19). Sie kommen aus der
     * Datenbank oder – solange dort nichts entschieden wurde – aus der `.env`;
     * zusammengeführt wird das im `TranscodeSettingsService`.
     */
    encoding: { preset: string; videoBitrate: string; maxrate: string; bufsize: string };
    onProgress?: (fraction: number) => void;
  }): Promise<void> {
    const { transcode } = this.config;
    const args = [
      '-hide_banner',
      '-nostdin',
      '-y',
      ...decodeArgs(transcode.videoEncoder),
      '-i',
      input.inputPath,
      '-map',
      '0:v:0',
      // Das `?` macht die Tonspur optional – stummes Material bricht sonst ab.
      '-map',
      '0:a:0?',
      ...videoEncodeArgs(transcode.videoEncoder, {
        preset: input.encoding.preset,
        videoBitrate: input.encoding.videoBitrate,
        maxrate: input.encoding.maxrate,
        bufsize: input.encoding.bufsize,
      }),
      '-pix_fmt',
      'yuv420p',
      '-vf',
      `scale=${input.width}:${input.height}`,
      '-fps_mode',
      'cfr',
    ];

    if (input.frameRate) {
      args.push('-r', `${input.frameRate.num}/${input.frameRate.den}`);
    }

    args.push(
      '-c:a',
      'aac',
      '-b:a',
      transcode.proxyAudioBitrate,
      '-ac',
      '2',
      // Ohne faststart liegt der Index am Dateiende und der Player müsste
      // erst alles laden, bevor er springen kann.
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      '-nostats',
      input.outputPath,
    );

    await this.run(this.config.transcode.ffmpegPath, args, {
      totalSeconds: input.durationSeconds ?? undefined,
      onProgress: input.onProgress,
    });
  }

  /**
   * Eine Download-Fassung aus einem Format-Preset (Phase 19).
   *
   * Anders als beim Proxy kommen Größe, Bitrate und Preset nicht aus der
   * Konfiguration, sondern aus dem Preset – gerechnet wird das in
   * `rendition-plan.ts`. Die Bildrate bleibt wie beim Proxy 1:1 und CFR: Auch
   * eine heruntergeladene Fassung soll frame-genau zum Original passen.
   */
  async createRendition(input: {
    inputPath: string;
    outputPath: string;
    width: number;
    height: number;
    videoBitrateKbps: number;
    audioBitrateKbps: number;
    preset: string;
    frameRate: FrameRate | null;
    durationSeconds: number | null;
    onProgress?: (fraction: number) => void;
  }): Promise<void> {
    const { videoEncoder } = this.config.transcode;
    const args = [
      '-hide_banner',
      '-nostdin',
      '-y',
      ...decodeArgs(videoEncoder),
      '-i',
      input.inputPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      ...videoEncodeArgs(videoEncoder, {
        preset: input.preset,
        videoBitrate: `${input.videoBitrateKbps}k`,
        maxrate: `${Math.round(input.videoBitrateKbps * 1.2)}k`,
        bufsize: `${Math.round(input.videoBitrateKbps * 2.4)}k`,
      }),
      '-pix_fmt',
      'yuv420p',
      '-vf',
      `scale=${input.width}:${input.height}`,
      '-fps_mode',
      'cfr',
    ];

    if (input.frameRate) {
      args.push('-r', `${input.frameRate.num}/${input.frameRate.den}`);
    }

    args.push(
      '-c:a',
      'aac',
      '-b:a',
      `${input.audioBitrateKbps}k`,
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      '-nostats',
      input.outputPath,
    );

    await this.run(this.config.transcode.ffmpegPath, args, {
      totalSeconds: input.durationSeconds ?? undefined,
      onProgress: input.onProgress,
    });
  }

  /**
   * Neu verpacken ohne neu zu kodieren: Bild und Ton werden 1:1 kopiert, nur
   * der Index wandert nach vorn. Das dauert Sekunden statt Minuten und lässt
   * die Qualität unangetastet.
   */
  async remux(input: { inputPath: string; outputPath: string }): Promise<void> {
    await this.run(
      this.config.transcode.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        input.inputPath,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        input.outputPath,
      ],
      {},
    );
  }

  /**
   * HLS-Stufenleiter in einem Durchlauf (Phase 13).
   *
   * Ein einziger ffmpeg-Aufruf für alle Stufen: Die Quelle wird nur einmal
   * dekodiert und über `split` an die Skalierer verteilt. Getrennte Läufe
   * würden ein 4K-Original mehrfach durchkauen.
   */
  async createHlsLadder(input: {
    inputPath: string;
    /** Verzeichnis, in dem `master.m3u8` und die Stufen-Ordner entstehen. */
    outputDir: string;
    rungs: LadderRung[];
    frameRate: FrameRate | null;
    durationSeconds: number | null;
    segmentSeconds: number;
    /** x264-Preset aus den Einstellungen (Phase 19). */
    preset: string;
    onProgress?: (fraction: number) => void;
  }): Promise<void> {
    const { rungs } = input;
    if (rungs.length === 0) throw new FfmpegError('Leere HLS-Leiter.', 0, '');

    // filter_complex: einmal dekodieren, dann je Stufe einmal skalieren.
    const split = `[0:v]split=${rungs.length}${rungs.map((_, index) => `[v${index}]`).join('')}`;
    const scales = rungs.map(
      (rung, index) => `[v${index}]scale=${rung.width}:${rung.height}[v${index}out]`,
    );

    const { videoEncoder } = this.config.transcode;
    const args = [
      '-hide_banner',
      '-nostdin',
      '-y',
      ...decodeArgs(videoEncoder),
      '-i',
      input.inputPath,
      '-filter_complex',
      [split, ...scales].join(';'),
    ];

    rungs.forEach((rung, index) => {
      args.push(
        '-map',
        `[v${index}out]`,
        ...videoEncodeArgs(videoEncoder, {
          preset: input.preset,
          videoBitrate: String(rung.bitrateBps),
          maxrate: String(rung.maxrateBps),
          bufsize: String(rung.maxrateBps * 2),
          streamIndex: index,
        }),
      );
      // Ton optional – stummes Material soll nicht abbrechen.
      args.push('-map', '0:a:0?', `-c:a:${index}`, 'aac', `-b:a:${index}`, '128k', '-ac', '2');
    });

    args.push('-pix_fmt', 'yuv420p', '-fps_mode', 'cfr');
    if (input.frameRate) {
      args.push('-r', `${input.frameRate.num}/${input.frameRate.den}`);
    }

    // Schlüsselbilder genau am Segmentanfang – sonst kann der Player nicht
    // sauber zwischen den Stufen wechseln.
    const fps = input.frameRate ? input.frameRate.num / input.frameRate.den : 25;
    const gop = Math.max(1, Math.round(fps * input.segmentSeconds));
    args.push(...keyframeArgs(videoEncoder, gop));

    args.push(
      '-f',
      'hls',
      '-hls_time',
      String(input.segmentSeconds),
      '-hls_playlist_type',
      'vod',
      '-hls_flags',
      'independent_segments',
      '-hls_segment_filename',
      `${input.outputDir}/%v/segment-%04d.ts`,
      '-master_pl_name',
      'master.m3u8',
      '-var_stream_map',
      rungs.map((rung, index) => `v:${index},a:${index},name:${rung.name}`).join(' '),
      '-progress',
      'pipe:1',
      '-nostats',
      `${input.outputDir}/%v/index.m3u8`,
    );

    await this.run(this.config.transcode.ffmpegPath, args, {
      totalSeconds: input.durationSeconds ?? undefined,
      onProgress: input.onProgress,
    });
  }

  /** Einzelbild als Vorschau. */
  async createPoster(input: {
    inputPath: string;
    outputPath: string;
    atSeconds: number;
    height: number;
  }): Promise<void> {
    await this.run(
      this.config.transcode.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        // `-ss` vor `-i` springt schnell (Keyframe-genau) – für ein
        // Vorschaubild völlig ausreichend.
        '-ss',
        input.atSeconds.toFixed(3),
        '-i',
        input.inputPath,
        '-frames:v',
        '1',
        '-vf',
        `scale=-2:${input.height}`,
        '-q:v',
        '3',
        input.outputPath,
      ],
      {},
    );
  }

  /** Kachelbild für die Timeline-Vorschau. */
  async createSprite(input: {
    inputPath: string;
    outputPath: string;
    plan: SpritePlan;
  }): Promise<void> {
    const { plan } = input;
    const filter = [
      `fps=1/${plan.intervalSeconds.toFixed(6)}`,
      `scale=${plan.tileWidth}:${plan.tileHeight}`,
      `tile=${plan.columns}x${plan.rows}`,
    ].join(',');

    await this.run(
      this.config.transcode.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        input.inputPath,
        '-vf',
        filter,
        '-frames:v',
        '1',
        '-q:v',
        '4',
        input.outputPath,
      ],
      {},
    );
  }

  /**
   * Startet das Programm und wartet auf das Ende. `-progress pipe:1` schreibt
   * fortlaufend `schlüssel=wert`-Zeilen auf die Standardausgabe; daraus wird
   * der Fortschritt abgeleitet.
   */
  private run(
    command: string,
    args: string[],
    options: RunOptions,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      this.logger.debug(`${command} ${args.join(' ')}`);
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderrTail = '';
      let progressBuffer = '';

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;

        if (!options.onProgress || !options.totalSeconds) return;
        progressBuffer += text;
        const lines = progressBuffer.split('\n');
        progressBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const seconds = parseProgressLine(line);
          if (seconds !== null) {
            options.onProgress(Math.max(0, Math.min(1, seconds / options.totalSeconds)));
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        // Nur das Ende behalten: ffmpeg-Fehler stehen unten, und ein langer
        // Lauf würde sonst viel Speicher belegen.
        stderrTail = (stderrTail + chunk.toString()).slice(-8000);
      });

      child.on('error', (error) => {
        reject(new FfmpegError(`${command} konnte nicht gestartet werden: ${error.message}`, null, ''));
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr: stderrTail });
          return;
        }
        reject(
          new FfmpegError(
            `${command} endete mit Code ${code}.`,
            code,
            stderrTail.split('\n').slice(-15).join('\n').trim(),
          ),
        );
      });
    });
  }
}

/** `out_time_us=12345678` bzw. `out_time_ms=…` → Sekunden. */
export function parseProgressLine(line: string): number | null {
  const match = line.trim().match(/^out_time_(us|ms)=(-?\d+)$/);
  if (!match) return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value) || value < 0) return null;
  // ffmpeg schreibt bei `out_time_ms` faktisch Mikrosekunden – beide
  // Schlüssel liefern denselben Maßstab.
  return value / 1_000_000;
}
