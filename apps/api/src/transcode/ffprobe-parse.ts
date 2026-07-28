/**
 * Auswertung der `ffprobe`-Ausgabe.
 *
 * Hier entstehen die Werte, auf denen der frame-genaue Counter im Player
 * steht: exakte Framerate als Bruch, Start-Timecode der Kamera und die Frage,
 * ob in Drop-Frame gezählt wird. Deshalb ist das eine reine Funktion mit
 * eigenen Tests statt Code irgendwo im Worker.
 */
import { type FrameRate, durationToFrameCount, parseFrameRate, timecodeToFrames } from '@klappe/shared';
import type { ProbeResult } from '../versions/versions.service';

export interface FfprobeStream {
  index?: number;
  codec_name?: string;
  codec_type?: string;
  codec_tag_string?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  nb_frames?: string;
  duration?: string;
  bit_rate?: string;
  tags?: Record<string, string>;
}

export interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    duration?: string;
    bit_rate?: string;
    format_name?: string;
    tags?: Record<string, string>;
  };
}

function toNumber(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Tags kommen je nach Container in unterschiedlicher Schreibweise
 * (`timecode`, `TIMECODE`, `TimeCode`), deshalb wird case-insensitiv gesucht.
 */
function findTag(tags: Record<string, string> | undefined, name: string): string | null {
  if (!tags) return null;
  const key = Object.keys(tags).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const value = key ? tags[key]?.trim() : undefined;
  return value ? value : null;
}

/**
 * Start-Timecode suchen: zuerst im eigenen `tmcd`-Datenstrom (QuickTime),
 * dann am Videostream, zuletzt in den Container-Tags (MXF, MP4).
 */
export function findStartTimecode(probe: FfprobeOutput): string | null {
  const streams = probe.streams ?? [];

  const timecodeStream = streams.find(
    (stream) => stream.codec_tag_string === 'tmcd' || stream.codec_name === 'timed_id3',
  );
  const fromTimecodeStream = findTag(timecodeStream?.tags, 'timecode');
  if (fromTimecodeStream) return fromTimecodeStream;

  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  const fromVideo = findTag(videoStream?.tags, 'timecode');
  if (fromVideo) return fromVideo;

  return findTag(probe.format?.tags, 'timecode');
}

/**
 * `r_frame_rate` ist die exakte Rate des Containers, `avg_frame_rate` die
 * gemessene. Bei ungültigem `r_frame_rate` (`0/0` kommt vor) wird auf den
 * Durchschnitt ausgewichen.
 */
export function pickFrameRate(stream: FfprobeStream | undefined): FrameRate | null {
  return parseFrameRate(stream?.r_frame_rate) ?? parseFrameRate(stream?.avg_frame_rate);
}

export function parseProbeOutput(probe: FfprobeOutput): ProbeResult {
  const streams = probe.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');

  const frameRate = pickFrameRate(video);
  const durationSeconds = toNumber(probe.format?.duration) ?? toNumber(video?.duration);

  const nbFrames = toNumber(video?.nb_frames);
  const frameCount =
    nbFrames && nbFrames > 0
      ? Math.round(nbFrames)
      : frameRate && durationSeconds
        ? durationToFrameCount(durationSeconds, frameRate)
        : null;

  const startTimecode = findStartTimecode(probe);
  // Ein Semikolon im Timecode ist die Kennzeichnung für Drop-Frame-Zählung.
  const dropFrame = Boolean(startTimecode?.includes(';'));

  let startTimecodeFrames = 0;
  if (startTimecode && frameRate) {
    try {
      startTimecodeFrames = timecodeToFrames(startTimecode, frameRate, dropFrame);
    } catch {
      // Ein unlesbarer Timecode darf den Import nicht scheitern lassen –
      // dann zählt das Video eben ab 00:00:00:00.
      startTimecodeFrames = 0;
    }
  }

  return {
    durationSeconds,
    frameCount,
    frameRate,
    dropFrame,
    startTimecode,
    startTimecodeFrames,
    width: toNumber(video?.width),
    height: toNumber(video?.height),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    pixelFormat: video?.pix_fmt ?? null,
    formatName: probe.format?.format_name ?? null,
    bitrateBps: toNumber(probe.format?.bit_rate) ?? toNumber(video?.bit_rate),
  };
}
