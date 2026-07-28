import { describe, expect, it } from 'vitest';
import { type FfprobeOutput, findStartTimecode, parseProbeOutput, pickFrameRate } from './ffprobe-parse';

const uhd2997: FfprobeOutput = {
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: 'h264',
      width: 3840,
      height: 2160,
      r_frame_rate: '30000/1001',
      avg_frame_rate: '30000/1001',
      nb_frames: '17982',
      bit_rate: '95000000',
      tags: { timecode: '10:00:00;00' },
    },
    { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le' },
  ],
  format: { duration: '600.0', bit_rate: '96000000', format_name: 'mov,mp4,m4a' },
};

describe('parseProbeOutput', () => {
  it('liest Auflösung, Codecs und Bitrate', () => {
    const result = parseProbeOutput(uhd2997);
    expect(result.width).toBe(3840);
    expect(result.height).toBe(2160);
    expect(result.videoCodec).toBe('h264');
    expect(result.audioCodec).toBe('pcm_s16le');
    expect(result.bitrateBps).toBe(96000000);
    expect(result.durationSeconds).toBe(600);
  });

  it('liefert die Framerate als exakten Bruch', () => {
    expect(parseProbeOutput(uhd2997).frameRate).toEqual({ num: 30000, den: 1001 });
  });

  it('erkennt Drop-Frame am Semikolon und rechnet den Start-Timecode in Frames um', () => {
    const result = parseProbeOutput(uhd2997);
    expect(result.dropFrame).toBe(true);
    expect(result.startTimecode).toBe('10:00:00;00');
    // 10 Stunden Drop-Frame bei 29,97
    expect(result.startTimecodeFrames).toBe(1078920);
  });

  it('behandelt Non-Drop-Timecode als solchen', () => {
    const result = parseProbeOutput({
      streams: [
        {
          codec_type: 'video',
          width: 1920,
          height: 1080,
          r_frame_rate: '25/1',
          tags: { timecode: '01:00:00:00' },
        },
      ],
      format: { duration: '10' },
    });
    expect(result.dropFrame).toBe(false);
    expect(result.startTimecodeFrames).toBe(90000);
  });

  it('nimmt nb_frames, wenn vorhanden', () => {
    expect(parseProbeOutput(uhd2997).frameCount).toBe(17982);
  });

  it('rechnet die Framezahl aus der Dauer, wenn nb_frames fehlt', () => {
    const result = parseProbeOutput({
      streams: [{ codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '25/1' }],
      format: { duration: '10.0' },
    });
    expect(result.frameCount).toBe(250);
  });

  it('weicht auf avg_frame_rate aus, wenn r_frame_rate unbrauchbar ist', () => {
    const result = parseProbeOutput({
      streams: [
        { codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '0/0', avg_frame_rate: '24/1' },
      ],
      format: { duration: '10' },
    });
    expect(result.frameRate).toEqual({ num: 24, den: 1 });
  });

  it('kommt mit einer Datei ohne Videostream klar', () => {
    const result = parseProbeOutput({ streams: [{ codec_type: 'audio', codec_name: 'aac' }], format: {} });
    expect(result.frameRate).toBeNull();
    expect(result.width).toBeNull();
    expect(result.frameCount).toBeNull();
    expect(result.startTimecodeFrames).toBe(0);
  });

  it('lässt einen unlesbaren Timecode den Import nicht sprengen', () => {
    const result = parseProbeOutput({
      streams: [
        { codec_type: 'video', width: 1920, height: 1080, r_frame_rate: '25/1', tags: { timecode: 'kaputt' } },
      ],
      format: { duration: '10' },
    });
    expect(result.startTimecode).toBe('kaputt');
    expect(result.startTimecodeFrames).toBe(0);
  });

  it('verträgt eine leere ffprobe-Ausgabe', () => {
    const result = parseProbeOutput({});
    expect(result.durationSeconds).toBeNull();
    expect(result.dropFrame).toBe(false);
  });
});

describe('findStartTimecode', () => {
  it('bevorzugt den tmcd-Datenstrom von QuickTime', () => {
    const timecode = findStartTimecode({
      streams: [
        { codec_type: 'video', tags: { timecode: '00:00:00:00' } },
        { codec_type: 'data', codec_tag_string: 'tmcd', tags: { timecode: '09:59:30:00' } },
      ],
    });
    expect(timecode).toBe('09:59:30:00');
  });

  it('fällt auf die Container-Tags zurück', () => {
    expect(findStartTimecode({ streams: [], format: { tags: { TIMECODE: '02:00:00:00' } } })).toBe(
      '02:00:00:00',
    );
  });

  it('gibt null zurück, wenn nirgends ein Timecode steht', () => {
    expect(findStartTimecode({ streams: [{ codec_type: 'video' }], format: {} })).toBeNull();
  });
});

describe('pickFrameRate', () => {
  it('gibt null, wenn beide Angaben unbrauchbar sind', () => {
    expect(pickFrameRate({ r_frame_rate: '0/0', avg_frame_rate: '0/0' })).toBeNull();
    expect(pickFrameRate(undefined)).toBeNull();
  });
});
