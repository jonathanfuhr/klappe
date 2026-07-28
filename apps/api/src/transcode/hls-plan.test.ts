import { describe, expect, it } from 'vitest';
import { buildMasterPlaylist, isSafeHlsFilename, planLadder } from './hls-plan';

describe('planLadder', () => {
  it('baut für UHD alle Stufen', () => {
    const leiter = planLadder(3840, 2160);
    expect(leiter.map((stufe) => stufe.name)).toEqual(['2160p', '1080p', '720p', '480p']);
  });

  it('skaliert nie hoch', () => {
    const leiter = planLadder(1280, 720);
    expect(leiter.map((stufe) => stufe.name)).toEqual(['720p', '480p']);
  });

  it('behält das Seitenverhältnis', () => {
    for (const stufe of planLadder(3840, 2160)) {
      expect(stufe.width / stufe.height).toBeCloseTo(16 / 9, 2);
    }
  });

  it('rechnet bei Hochformat mit der kurzen Kante', () => {
    const leiter = planLadder(2160, 3840);
    expect(leiter[0]).toMatchObject({ name: '2160p', width: 2160, height: 3840 });
    expect(leiter[1]).toMatchObject({ name: '1080p', width: 1080, height: 1920 });
  });

  it('kommt mit quadratischem Material zurecht', () => {
    const leiter = planLadder(1080, 1080);
    expect(leiter[0]).toMatchObject({ name: '1080p', width: 1080, height: 1080 });
  });

  it('liefert nur gerade Kantenlängen – H.264 verlangt das', () => {
    for (const stufe of planLadder(1920, 1080)) {
      expect(stufe.width % 2).toBe(0);
      expect(stufe.height % 2).toBe(0);
    }
    for (const stufe of planLadder(1439, 1079)) {
      expect(stufe.width % 2).toBe(0);
      expect(stufe.height % 2).toBe(0);
    }
  });

  it('deckelt auf Wunsch die oberste Stufe', () => {
    const leiter = planLadder(3840, 2160, { maxShortEdge: 1080 });
    expect(leiter.map((stufe) => stufe.name)).toEqual(['1080p', '720p', '480p']);
  });

  it('gibt auch sehr kleinem Material eine Stufe', () => {
    const leiter = planLadder(320, 240);
    expect(leiter).toHaveLength(1);
    expect(leiter[0].width).toBe(320);
  });

  it('nennt für jede Stufe eine Bitrate mit Luft nach oben', () => {
    for (const stufe of planLadder(3840, 2160)) {
      expect(stufe.maxrateBps).toBeGreaterThan(stufe.bitrateBps);
    }
  });

  it('verteilt die Bitraten absteigend', () => {
    const leiter = planLadder(3840, 2160);
    for (let index = 1; index < leiter.length; index += 1) {
      expect(leiter[index].bitrateBps).toBeLessThan(leiter[index - 1].bitrateBps);
    }
  });

  it('macht aus Unsinn eine leere Leiter statt eines Absturzes', () => {
    expect(planLadder(0, 0)).toEqual([]);
    expect(planLadder(-10, 100)).toEqual([]);
  });
});

describe('buildMasterPlaylist', () => {
  it('nennt jede Stufe mit Bandbreite und Auflösung', () => {
    const playlist = buildMasterPlaylist(planLadder(1920, 1080));

    expect(playlist.startsWith('#EXTM3U')).toBe(true);
    expect(playlist).toContain('RESOLUTION=1920x1080');
    expect(playlist).toContain('1080p/index.m3u8');
    expect(playlist).toContain('720p/index.m3u8');
  });

  it('führt so viele Einträge wie Stufen', () => {
    const leiter = planLadder(3840, 2160);
    const playlist = buildMasterPlaylist(leiter);
    expect(playlist.match(/#EXT-X-STREAM-INF/g)).toHaveLength(leiter.length);
  });

  it('endet mit einem Zeilenumbruch – manche Player sind da eigen', () => {
    expect(buildMasterPlaylist(planLadder(1280, 720)).endsWith('\n')).toBe(true);
  });
});

describe('isSafeHlsFilename', () => {
  it('lässt Playlists und Segmente durch', () => {
    expect(isSafeHlsFilename('index.m3u8')).toBe(true);
    expect(isSafeHlsFilename('segment-005.ts')).toBe(true);
    expect(isSafeHlsFilename('init.mp4')).toBe(true);
  });

  it('blockt Ausbrüche und alles Fremde', () => {
    expect(isSafeHlsFilename('../../etc/passwd')).toBe(false);
    expect(isSafeHlsFilename('..')).toBe(false);
    expect(isSafeHlsFilename('a/b.ts')).toBe(false);
    expect(isSafeHlsFilename('index.m3u8.sh')).toBe(false);
    expect(isSafeHlsFilename('')).toBe(false);
  });
});
