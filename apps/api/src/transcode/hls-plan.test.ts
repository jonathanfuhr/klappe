import { describe, expect, it } from 'vitest';
import {
  buildMasterPlaylist,
  filterMasterPlaylist,
  isSafeHlsFilename,
  planLadder,
} from './hls-plan';

describe('planLadder', () => {
  it('deckelt UHD bei 1080p – höher geht es seit 1.7.1 nicht mehr', () => {
    // Die 2160p-Stufe ist bewusst weg: Sie war mit 16 Mbit/s angesetzt und
    // passte nie durch den Weg, über den die Kunden hereinkommen. Siehe die
    // Begründung an `RUNGS`.
    const leiter = planLadder(3840, 2160);
    expect(leiter.map((stufe) => stufe.name)).toEqual(['1080p', '720p', '480p']);
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
    // Quelle 2160x3840: Die kurze Kante ist 2160, die oberste Stufe der Leiter
    // aber 1080 – heruntergerechnet wird auf 1080x1920.
    const leiter = planLadder(2160, 3840);
    expect(leiter[0]).toMatchObject({ name: '1080p', width: 1080, height: 1920 });
    expect(leiter[1]).toMatchObject({ name: '720p', width: 720, height: 1280 });
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

describe('filterMasterPlaylist', () => {
  const playlist = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=19200000,AVERAGE-BANDWIDTH=16000000,RESOLUTION=3840x2160,CODECS="avc1.640028,mp4a.40.2"',
    '2160p/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=7200000,AVERAGE-BANDWIDTH=6000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
    '1080p/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1680000,AVERAGE-BANDWIDTH=1400000,RESOLUTION=854x480,CODECS="avc1.640028,mp4a.40.2"',
    '480p/index.m3u8',
    '',
  ].join('\n');

  it('nimmt zu grosse Stufen samt ihrer Adresse heraus', () => {
    const gefiltert = filterMasterPlaylist(playlist);
    expect(gefiltert).not.toContain('2160p/index.m3u8');
    expect(gefiltert).not.toContain('3840x2160');
    expect(gefiltert).toContain('1080p/index.m3u8');
    expect(gefiltert).toContain('480p/index.m3u8');
  });

  it('behaelt Kopfzeilen und Reihenfolge', () => {
    const zeilen = filterMasterPlaylist(playlist).split('\n');
    expect(zeilen[0]).toBe('#EXTM3U');
    expect(zeilen[1]).toBe('#EXT-X-VERSION:3');
    // Kennzeile und Adresse gehoeren zusammen und duerfen nicht verrutschen.
    expect(zeilen[2]).toContain('1920x1080');
    expect(zeilen[3]).toBe('1080p/index.m3u8');
  });

  it('rechnet im Hochformat mit der kurzen Kante', () => {
    // 2160x3840 ist Hochformat-UHD: kurze Kante 2160, muss raus.
    const hoch = playlist.replace('3840x2160', '2160x3840').replace('1920x1080', '1080x1920');
    const gefiltert = filterMasterPlaylist(hoch);
    expect(gefiltert).not.toContain('2160x3840');
    expect(gefiltert).toContain('1080x1920');
  });

  it('laesst eine Playlist in Ruhe, in der nichts zu gross ist', () => {
    const klein = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1680000,RESOLUTION=854x480',
      '480p/index.m3u8',
      '',
    ].join('\n');
    expect(filterMasterPlaylist(klein)).toBe(klein);
  });

  it('gibt lieber die Vorlage zurueck, als alles wegzufiltern', () => {
    // Ein Video, das aussetzt, ist aergerlich – eines, das gar nicht mehr
    // laeuft, ist schlimmer.
    const nurGross = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=19200000,RESOLUTION=3840x2160',
      '2160p/index.m3u8',
      '',
    ].join('\n');
    expect(filterMasterPlaylist(nurGross)).toBe(nurGross);
  });

  it('laesst Stufen ohne Aufloesungsangabe stehen', () => {
    const ohne = ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1000000', 'x/index.m3u8', ''].join('\n');
    expect(filterMasterPlaylist(ohne)).toContain('x/index.m3u8');
  });
});
