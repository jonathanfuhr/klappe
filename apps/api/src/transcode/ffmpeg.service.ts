import { Inject, Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import type { FrameRate } from '@klappe/shared';
import { AppConfig, CONFIG } from '../config/configuration';
import { type FfprobeOutput, parseProbeOutput } from './ffprobe-parse';
import type { ProbeResult } from '../versions/versions.service';
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
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

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
    onProgress?: (fraction: number) => void;
  }): Promise<void> {
    const { transcode } = this.config;
    const args = [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      input.inputPath,
      '-map',
      '0:v:0',
      // Das `?` macht die Tonspur optional – stummes Material bricht sonst ab.
      '-map',
      '0:a:0?',
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-preset',
      transcode.proxyPreset,
      '-b:v',
      transcode.proxyVideoBitrate,
      '-maxrate',
      transcode.proxyMaxrate,
      '-bufsize',
      transcode.proxyBufsize,
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
