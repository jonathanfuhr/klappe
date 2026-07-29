import { describe, expect, it } from 'vitest';
import { parseBitrateKbps } from './transcode-settings.service';

describe('parseBitrateKbps', () => {
  it('versteht die ffmpeg-Schreibweisen', () => {
    expect(parseBitrateKbps('10M')).toBe(10_000);
    expect(parseBitrateKbps('10m')).toBe(10_000);
    expect(parseBitrateKbps('2.5M')).toBe(2500);
    expect(parseBitrateKbps('192k')).toBe(192);
    expect(parseBitrateKbps('192K')).toBe(192);
  });

  it('liest eine nackte Zahl als bit/s – so meint es ffmpeg', () => {
    expect(parseBitrateKbps('10000000')).toBe(10_000);
  });

  it('nimmt auch ein Komma', () => {
    expect(parseBitrateKbps('2,5M')).toBe(2500);
  });

  it('gibt bei Unbrauchbarem null zurück, statt zu raten', () => {
    expect(parseBitrateKbps(null)).toBeNull();
    expect(parseBitrateKbps('')).toBeNull();
    expect(parseBitrateKbps('viel')).toBeNull();
    expect(parseBitrateKbps('0')).toBeNull();
    expect(parseBitrateKbps('-5M')).toBeNull();
    expect(parseBitrateKbps('10 Mbit')).toBeNull();
  });
});
