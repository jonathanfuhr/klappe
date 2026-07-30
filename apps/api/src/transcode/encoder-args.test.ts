import { describe, expect, it } from 'vitest';
import { decodeArgs, isVideoEncoder, keyframeArgs, videoEncodeArgs } from './encoder-args';

const WERTE = { preset: 'veryfast', videoBitrate: '10M', maxrate: '12M', bufsize: '24M' };

describe('videoEncodeArgs', () => {
  // Die libx264-Fälle vergleichen wortgleich mit den früheren Literalen aus
  // dem FfmpegService: Solange diese Tests grün sind, ist bewiesen, dass sich
  // auf einer Software-Installation (Unraid) kein einziges Argument ändert.
  it('liefert für libx264 exakt die bisherigen Argumente', () => {
    expect(videoEncodeArgs('libx264', WERTE)).toEqual([
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-preset',
      'veryfast',
      '-b:v',
      '10M',
      '-maxrate',
      '12M',
      '-bufsize',
      '24M',
    ]);
  });

  it('liefert für libx264 je Leiterstufe die bisherige Reihenfolge (Preset hinten)', () => {
    const args = videoEncodeArgs('libx264', {
      ...WERTE,
      videoBitrate: '6000000',
      maxrate: '7200000',
      bufsize: '14400000',
      streamIndex: 2,
    });
    expect(args).toEqual([
      '-c:v:2',
      'libx264',
      '-b:v:2',
      '6000000',
      '-maxrate:v:2',
      '7200000',
      '-bufsize:v:2',
      '14400000',
      '-preset:v:2',
      'veryfast',
    ]);
  });

  it('lässt bei VideoToolbox das x264-Preset weg und erlaubt den Software-Rückfall', () => {
    const args = videoEncodeArgs('h264_videotoolbox', WERTE);
    expect(args).toEqual([
      '-c:v',
      'h264_videotoolbox',
      '-profile:v',
      'high',
      '-allow_sw',
      '1',
      '-b:v',
      '10M',
      '-maxrate',
      '12M',
      '-bufsize',
      '24M',
    ]);
    expect(args).not.toContain('-preset');
    expect(args).not.toContain('veryfast');
  });

  it('setzt bei VideoToolbox in der Leiter Profil und Rückfall je Stufe', () => {
    expect(videoEncodeArgs('h264_videotoolbox', { ...WERTE, streamIndex: 0 })).toEqual([
      '-c:v:0',
      'h264_videotoolbox',
      '-profile:v:0',
      'high',
      '-allow_sw:v:0',
      '1',
      '-b:v:0',
      '10M',
      '-maxrate:v:0',
      '12M',
      '-bufsize:v:0',
      '24M',
    ]);
  });
});

describe('decodeArgs', () => {
  it('bleibt bei libx264 leer', () => {
    expect(decodeArgs('libx264')).toEqual([]);
  });

  it('schaltet bei VideoToolbox den Hardware-Decode vor', () => {
    expect(decodeArgs('h264_videotoolbox')).toEqual(['-hwaccel', 'videotoolbox']);
  });
});

describe('keyframeArgs', () => {
  it('liefert für libx264 die bisherigen drei Angaben', () => {
    expect(keyframeArgs('libx264', 100)).toEqual([
      '-g',
      '100',
      '-keyint_min',
      '100',
      '-sc_threshold',
      '0',
    ]);
  });

  it('beschränkt sich bei VideoToolbox auf das Keyframe-Intervall', () => {
    expect(keyframeArgs('h264_videotoolbox', 100)).toEqual(['-g', '100']);
  });
});

describe('isVideoEncoder', () => {
  it('kennt genau die beiden Encoder', () => {
    expect(isVideoEncoder('libx264')).toBe(true);
    expect(isVideoEncoder('h264_videotoolbox')).toBe(true);
    expect(isVideoEncoder('hevc_videotoolbox')).toBe(false);
    expect(isVideoEncoder('')).toBe(false);
  });
});
