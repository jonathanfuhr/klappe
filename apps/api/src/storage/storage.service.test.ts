import { describe, expect, it } from 'vitest';
import { dateisystemArtAus, istDurchgereicht } from './storage.service';

/**
 * Hintergrund dieser Tests: Auf einem Unraid stimmte die Speicheranzeige, auf
 * einem Mac Mini meldete sie 57,1 TB frei auf einer 2-TB-Platte. Grund war,
 * dass der Stack auf dem Mac in einer Linux-VM läuft und `MEDIA_DIR` per
 * VirtioFS hineingereicht wird – `statfs` beschreibt dann die VM, nicht APFS.
 *
 * Die Erkennung muss deshalb zwei Dinge zugleich können: die Durchreiche
 * erkennen *und* die Unraid-User-Shares in Ruhe lassen, die ebenfalls FUSE
 * sind, ihre Größe aber wahrheitsgemäß melden.
 */

/** Wie es im Container unter Docker Desktop auf dem Mac aussieht. */
const MOUNTINFO_MAC = [
  '2075 2058 0:157 / / rw,relatime - overlay overlay rw,lowerdir=/var/lib/docker/overlay2/l/AAA',
  '2085 2075 0:161 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw',
  '2109 2075 0:69 /Users/jonathan/klappe-media /data rw,relatime - virtiofs virtiofs rw',
].join('\n');

/** Ein Unraid: User-Share über FUSE, meldet aber die echte Array-Größe. */
const MOUNTINFO_UNRAID = [
  '1234 1200 0:41 / / rw,relatime - overlay overlay rw,lowerdir=/var/lib/docker/overlay2/l/BBB',
  '1300 1234 0:52 /klappe /data rw,relatime - fuse.shfs /dev/shfs rw,user_id=0,group_id=0',
].join('\n');

/** Ein gewöhnlicher Linux-Server mit XFS. */
const MOUNTINFO_XFS = [
  '30 1 0:24 / / rw,relatime - xfs /dev/sda2 rw,attr2,inode64',
  '55 30 0:24 /srv/klappe /data rw,relatime - xfs /dev/sda2 rw,attr2,inode64',
].join('\n');

describe('dateisystemArtAus', () => {
  it('findet die Durchreiche unter Docker Desktop auf dem Mac', () => {
    expect(dateisystemArtAus(MOUNTINFO_MAC, '/data')).toBe('virtiofs');
  });

  it('nimmt den längsten passenden Einhängepunkt, nicht den ersten', () => {
    // `/` passt hier ebenfalls – gemeint ist aber `/data`. Ginge das schief,
    // sähe die API das overlay-Dateisystem des Containers und meldete dessen
    // Größe als die des Medienordners.
    expect(dateisystemArtAus(MOUNTINFO_MAC, '/data/originals/abc/clip.mov')).toBe('virtiofs');
    expect(dateisystemArtAus(MOUNTINFO_XFS, '/data/hls')).toBe('xfs');
  });

  it('fällt auf die Wurzel zurück, wenn es keinen näheren Punkt gibt', () => {
    expect(dateisystemArtAus(MOUNTINFO_XFS, '/anderswo')).toBe('xfs');
  });

  it('verwechselt Pfade mit gleichem Anfang nicht', () => {
    // `/database` beginnt mit `/data`, liegt aber nicht darin.
    expect(dateisystemArtAus(MOUNTINFO_MAC, '/database')).toBe('overlay');
  });

  it('versteht oktal maskierte Sonderzeichen im Einhängepunkt', () => {
    const mit = '99 1 0:1 / /mnt/Mein\\040Ordner rw - virtiofs virtiofs rw';
    expect(dateisystemArtAus(mit, '/mnt/Mein Ordner/klappe')).toBe('virtiofs');
  });

  it('kommt mit den optionalen Feldern vor dem Trenner zurecht', () => {
    // Zwischen Optionen und " - " können beliebig viele Felder stehen
    // (`shared:1 master:2`). Feste Indizes gingen daran kaputt.
    const mit = '77 1 0:1 / /data rw,relatime shared:1 master:2 - virtiofs virtiofs rw';
    expect(dateisystemArtAus(mit, '/data')).toBe('virtiofs');
  });

  it('gibt null zurück, wenn nichts passt', () => {
    expect(dateisystemArtAus('', '/data')).toBeNull();
    expect(dateisystemArtAus('kaputte zeile ohne trenner', '/data')).toBeNull();
  });
});

describe('istDurchgereicht', () => {
  it('erkennt die bekannten Durchreichen', () => {
    for (const art of ['virtiofs', 'fuse.grpcfuse', 'grpcfuse', 'osxfs', '9p', 'vboxsf']) {
      expect(istDurchgereicht(art)).toBe(true);
    }
  });

  it('lässt echte Dateisysteme in Ruhe – besonders die Unraid-User-Shares', () => {
    // `fuse.shfs` ist zwar FUSE, meldet aber die wahre Array-Größe. Würde es
    // pauschal mit verworfen, verlöre der Hauptanwendungsfall seine Anzeige.
    expect(istDurchgereicht(dateisystemArtAus(MOUNTINFO_UNRAID, '/data'))).toBe(false);
    for (const art of ['xfs', 'ext4', 'btrfs', 'zfs', 'overlay', 'nfs4', 'cifs']) {
      expect(istDurchgereicht(art)).toBe(false);
    }
  });

  it('behandelt „unbekannt" als brauchbar', () => {
    // `null` heißt: nicht Linux oder kein /proc – etwa der native Worker auf
    // dem Mac, der ohnehin direkt auf die echte Platte schaut.
    expect(istDurchgereicht(null)).toBe(false);
  });
});
