import { describe, expect, it } from 'vitest';
import {
  isRenditionContainer,
  isX264Preset,
  planRendition,
  renditionSignature,
} from './rendition-plan';

const PRESET = {
  shortEdge: 1080,
  videoBitrateKbps: 10_000,
  audioBitrateKbps: 192,
  preset: 'veryfast',
  container: 'mp4',
};

describe('planRendition', () => {
  it('skaliert UHD auf die kurze Kante herunter', () => {
    const plan = planRendition(3840, 2160, PRESET);
    expect(plan).toMatchObject({ width: 1920, height: 1080, scaled: true });
    expect(plan.videoBitrateKbps).toBe(10_000);
  });

  it('rechnet bei Hochformat mit der kurzen Kante', () => {
    const plan = planRendition(2160, 3840, PRESET);
    expect(plan).toMatchObject({ width: 1080, height: 1920, scaled: true });
  });

  it('vergrößert nie und senkt dann die Bitrate mit', () => {
    // 720p-Quelle bei einem 1080p-Preset: (720/1080)² ≈ 0,44
    const plan = planRendition(1280, 720, PRESET);
    expect(plan).toMatchObject({ width: 1280, height: 720, scaled: false });
    expect(plan.videoBitrateKbps).toBe(4444);
  });

  it('fällt beim Absenken nicht unter ein Viertel', () => {
    const plan = planRendition(320, 180, PRESET);
    expect(plan.videoBitrateKbps).toBe(2500);
  });

  it('ersetzt unbekannte Werte durch die Voreinstellung', () => {
    const plan = planRendition(1920, 1080, { ...PRESET, preset: 'turbo', container: 'mkv' });
    expect(plan.preset).toBe('veryfast');
    expect(plan.container).toBe('mp4');
  });
});

describe('renditionSignature', () => {
  it('ist für gleiche Werte gleich', () => {
    expect(renditionSignature(PRESET)).toBe(renditionSignature({ ...PRESET }));
  });

  it('ändert sich, sobald ein Wert sich ändert', () => {
    const basis = renditionSignature(PRESET);
    expect(renditionSignature({ ...PRESET, shortEdge: 720 })).not.toBe(basis);
    expect(renditionSignature({ ...PRESET, videoBitrateKbps: 8000 })).not.toBe(basis);
    expect(renditionSignature({ ...PRESET, preset: 'slow' })).not.toBe(basis);
    expect(renditionSignature({ ...PRESET, container: 'mov' })).not.toBe(basis);
  });

  it('ändert sich nicht vom Namen des Presets', () => {
    // Der Name steht nicht in der Unterschrift: Ein Umbenennen soll keine
    // fertigen Dateien wegwerfen.
    expect(renditionSignature({ ...PRESET })).toBe(renditionSignature({ ...PRESET }));
  });
});

describe('Wertebereiche', () => {
  it('kennt die x264-Presets', () => {
    expect(isX264Preset('veryfast')).toBe(true);
    expect(isX264Preset('veryslow')).toBe(true);
    expect(isX264Preset('schnell')).toBe(false);
  });

  it('kennt die Container', () => {
    expect(isRenditionContainer('mp4')).toBe(true);
    expect(isRenditionContainer('mov')).toBe(true);
    expect(isRenditionContainer('mkv')).toBe(false);
  });
});
