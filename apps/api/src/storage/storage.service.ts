import { Inject, Injectable, Logger } from '@nestjs/common';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { AppConfig, CONFIG } from '../config/configuration';

/**
 * Dateisysteme, die einen Ordner aus einer *anderen* Maschine durchreichen –
 * aus dem Wirtssystem in eine virtuelle Maschine und von dort in den
 * Container. Ihre Größenangaben beziehen sich nicht auf die Platte, auf der
 * die Dateien tatsächlich liegen; `statfs` bekommt hier Zahlen der
 * Zwischenschicht und nicht der echten Ablage.
 *
 * Praktischer Fall: Docker Desktop auf dem Mac. Der Stack läuft dort in einer
 * Linux-VM, `MEDIA_DIR` wird per VirtioFS aus macOS hineingereicht – die API
 * sieht die APFS-Volume nie und meldete stur die Zahlen der VM. Dasselbe gilt
 * für WSL2 (`9p`) und die alten Docker-Toolbox-Freigaben (`vboxsf`).
 *
 * Bewusst **nicht** in der Liste: `fuse.shfs`. Das sind die User-Shares auf
 * einem Unraid (`/mnt/user/...`), ebenfalls FUSE – die melden aber die echte
 * Größe des Arrays. Deshalb wird hier nach der konkreten Art gefragt und
 * nicht pauschal alles FUSE verworfen; sonst verlöre der Hauptanwendungsfall
 * seine Anzeige.
 */
const DURCHGEREICHTE_DATEISYSTEME = new Set([
  'virtiofs',
  'grpcfuse',
  'fuse.grpcfuse',
  'osxfs',
  'fuse.osxfs',
  'fuse.sshfs',
  '9p',
  'vboxsf',
]);

/**
 * Einhängepunkte stehen in `mountinfo` mit oktal maskierten Sonderzeichen –
 * ein Leerzeichen im Pfad wäre sonst nicht vom Feldtrenner zu unterscheiden.
 */
function entmaskiere(pfad: string): string {
  return pfad.replace(/\\([0-7]{3})/g, (_, oktal: string) =>
    String.fromCharCode(parseInt(oktal, 8)),
  );
}

/**
 * Sucht in einer `/proc/self/mountinfo` die Art des Dateisystems, auf dem ein
 * Pfad liegt. Eigene Funktion, weil hier die eigentliche Denkarbeit steckt und
 * sie sich so ohne echtes `/proc` prüfen lässt.
 *
 * Genommen wird der **längste** passende Einhängepunkt: Für `/data/originals`
 * treffen `/` und `/data` beide zu, gemeint ist der speziellere.
 */
export function dateisystemArtAus(mountinfo: string, pfad: string): string | null {
  let treffer: { punkt: string; art: string } | null = null;
  for (const zeile of mountinfo.split('\n')) {
    // Vor dem " - " stehen die Felder mit dem Einhängepunkt, dahinter beginnt
    // es mit der Art. Dazwischen liegen optionale Felder unbekannter Anzahl –
    // deshalb der Trenner statt fester Indizes.
    const trenner = zeile.indexOf(' - ');
    if (trenner < 0) continue;
    const punkt = entmaskiere(zeile.slice(0, trenner).split(' ')[4] ?? '');
    const art = zeile.slice(trenner + 3).split(' ')[0] ?? '';
    if (!punkt || !art) continue;
    const passt = pfad === punkt || punkt === '/' || pfad.startsWith(punkt + sep);
    if (!passt) continue;
    if (!treffer || punkt.length > treffer.punkt.length) treffer = { punkt, art };
  }
  return treffer?.art ?? null;
}

/** Reicht diese Dateisystemart ihre Größenangaben aus einer VM durch? */
export function istDurchgereicht(art: string | null): boolean {
  return art !== null && DURCHGEREICHTE_DATEISYSTEME.has(art);
}

/**
 * Ablage auf dem Docker-Volume. Alles läuft über *Schlüssel* (relative Pfade
 * unterhalb von `STORAGE_DIR`) statt über absolute Pfade – dadurch lässt sich
 * die Ablage später auf S3/MinIO umstellen, ohne die Aufrufer anzufassen.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly root: string;

  constructor(@Inject(CONFIG) config: AppConfig) {
    this.root = resolve(config.storage.root);
  }

  /** Schlüssel → absoluter Pfad, mit Schutz gegen `../`-Ausbrüche. */
  resolveKey(key: string): string {
    const cleaned = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    const absolute = resolve(this.root, cleaned);
    if (absolute !== this.root && !absolute.startsWith(this.root + sep)) {
      throw new Error(`Ungültiger Ablage-Schlüssel: "${key}"`);
    }
    return absolute;
  }

  keyForOriginal(versionId: string, filename: string): string {
    return join('originals', versionId, filename);
  }

  keyForUploadPart(uploadId: string): string {
    return join('tmp', 'uploads', `${uploadId}.part`);
  }

  /**
   * Wo die Verarbeitung im Zwischenspeicher ihre Ergebnisse ablegt (Phase 18).
   * Ein Verzeichnis je Sitzung, damit der Umzug beim Speichern – und das
   * Wegräumen beim Abbruch – eine einzige Bewegung ist.
   */
  keyForUploadWorkDir(uploadId: string): string {
    return join('tmp', 'verarbeitung', uploadId);
  }

  keyForProxy(versionId: string): string {
    return join('proxies', `${versionId}.mp4`);
  }

  keyForPoster(versionId: string): string {
    return join('posters', `${versionId}.jpg`);
  }

  keyForSprite(versionId: string): string {
    return join('sprites', `${versionId}.jpg`);
  }

  /** Verzeichnis der HLS-Stufenleiter einer Fassung (Phase 13). */
  keyForHlsDir(versionId: string): string {
    return join('hls', versionId);
  }

  /**
   * Eine erzeugte Download-Fassung (Phase 19). Ein Verzeichnis je Fassung,
   * damit das Löschen einer Version alles in einem Zug mitnimmt.
   */
  keyForRendition(versionId: string, renditionId: string, container: string): string {
    const endung = container.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4';
    return join('renditions', versionId, `${renditionId}.${endung}`);
  }

  keyForRenditionDir(versionId: string): string {
    return join('renditions', versionId);
  }

  /**
   * Datei im Kunden-Ordner eines Projekts. Die Upload-ID im Pfad verhindert,
   * dass zwei gleichnamige Dateien einander überschreiben.
   */
  keyForProjectFile(projectId: string, uploadId: string, filename: string): string {
    return join('project-files', projectId, `${uploadId}-${filename}`);
  }

  /** Der ganze Kunden-Ordner eines Projekts – zum Aufräumen beim Löschen. */
  keyForProjectFilesDir(projectId: string): string {
    return join('project-files', projectId);
  }

  /**
   * Logo des Workspace. Die Endung steckt im Namen, damit beim Wechsel von
   * SVG auf PNG nicht die alte Datei liegen bleibt und ausgeliefert wird.
   */
  keyForBrandLogo(extension: string): string {
    return join('branding', `logo.${extension}`);
  }

  /** Eigenes Tab-Symbol (Phase 23) – neben dem Logo, nicht statt seiner. */
  keyForFavicon(extension: string): string {
    return join('branding', `favicon.${extension}`);
  }

  /**
   * Das gerasterte App-Symbol (Phase 24).
   *
   * Abgeleitet aus Logo oder eigenem Tab-Symbol, immer als quadratisches PNG.
   * Ein SVG taugt weder für den Startbildschirm eines iPhones noch für ältere
   * Browser-Tabs; ein PNG nimmt jeder.
   */
  keyForAppIcon(): string {
    return join('branding', 'app-icon.png');
  }

  /** Schreibt eine kleine Datei am Stück – für Logos und Ähnliches. */
  async writeFile(key: string, data: Buffer): Promise<void> {
    await this.ensureDirForKey(key);
    await writeFile(this.resolveKey(key), data);
  }

  async ensureDirForKey(key: string): Promise<void> {
    await mkdir(dirname(this.resolveKey(key)), { recursive: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async size(key: string): Promise<number> {
    try {
      const info = await stat(this.resolveKey(key));
      return info.size;
    } catch {
      return 0;
    }
  }

  /**
   * Art des Dateisystems, auf dem ein Pfad liegt – oder `null`, wenn sich das
   * nicht feststellen lässt.
   *
   * Nur unter Linux beantwortbar, denn nur dort gibt es `/proc`. Das genügt:
   * Die Frage stellt sich ausschließlich für den Prozess *im Container*.
   * Läuft Klappe nativ (der Worker auf einem Mac), schaut es ohnehin direkt
   * auf die echte Platte, und dann ist die Antwort „unbekannt" richtig – wir
   * verwerfen die Zahlen dann nicht.
   *
   * Gesucht wird der *längste* passende Einhängepunkt: `/data` und `/` können
   * beide zutreffen, gültig ist der speziellere von beiden.
   */
  private async dateisystemArt(pfad: string): Promise<string | null> {
    if (process.platform !== 'linux') return null;
    try {
      return dateisystemArtAus(await readFile('/proc/self/mountinfo', 'utf8'), pfad);
    } catch {
      return null;
    }
  }

  /**
   * Platz auf dem Dateisystem, auf dem die Ablage liegt (Phase 22).
   *
   * Gemessen wird das **Dateisystem**, nicht der Ordner: Im Container ist das
   * die Einhängung hinter `STORAGE_DIR`, also genau das Volume, das volllaufen
   * kann. Ein rekursives Durchzählen des Baums wäre etwas anderes und viel
   * teurer – bei HLS geht es um Zehntausende Segmentdateien.
   *
   * `null`, wenn das Betriebssystem keine Auskunft gibt. Ist der Ordner aus
   * einer virtuellen Maschine durchgereicht, kommen zwar Zahlen zurück, sie
   * beschreiben aber die falsche Platte – dann wird `passthroughFs` gesetzt
   * und die Größen bleiben leer. Lieber keine Zahl als eine erfundene: Die
   * Anzeige beantwortet die Frage „passt der nächste Dreh noch drauf?", und
   * darauf eine falsche Antwort zu geben ist schlimmer als gar keine.
   */
  async freeSpace(): Promise<{
    path: string;
    passthroughFs: string | null;
    totalBytes: number | null;
    freeBytes: number | null;
    usedBytes: number | null;
  } | null> {
    const art = await this.dateisystemArt(this.root);
    if (istDurchgereicht(art)) {
      this.logger.log(
        `Freier Platz für ${this.root} wird nicht angezeigt: liegt auf "${art}", einer ` +
          'Durchreiche aus einer virtuellen Maschine – die gemeldeten Größen gehören nicht ' +
          'zur echten Platte.',
      );
      return { path: this.root, passthroughFs: art, totalBytes: null, freeBytes: null, usedBytes: null };
    }

    try {
      const info = await statfs(this.root);
      const block = Number(info.bsize);
      const blocks = Number(info.blocks);
      return {
        path: this.root,
        passthroughFs: null,
        totalBytes: blocks * block,
        // `bavail`, nicht `bfree`: Ein Teil bleibt für root reserviert und
        // steht dem Dienst nicht zur Verfügung. `df` zeigt aus demselben
        // Grund „Avail" statt „Free" – und deshalb ergeben belegt und frei
        // zusammen etwas weniger als die Gesamtgröße.
        freeBytes: Number(info.bavail) * block,
        usedBytes: (blocks - Number(info.bfree)) * block,
      };
    } catch (error) {
      this.logger.warn(`Freier Platz für ${this.root} nicht abfragbar: ${String(error)}`);
      return null;
    }
  }

  /**
   * Schreibstrom zum Anhängen. Der Aufrufer baut die Kette selbst zusammen
   * (`pipeline(body, limiter, stream)`), damit Fehler aus allen Gliedern an
   * einer Stelle ankommen und die Datei nicht halb offen liegen bleibt.
   */
  async createAppendStream(key: string): Promise<NodeJS.WritableStream> {
    await this.ensureDirForKey(key);
    return createWriteStream(this.resolveKey(key), { flags: 'a' });
  }

  async move(fromKey: string, toKey: string): Promise<void> {
    await this.ensureDirForKey(toKey);
    await rename(this.resolveKey(fromKey), this.resolveKey(toKey));
  }

  async remove(key: string): Promise<void> {
    try {
      await rm(this.resolveKey(key), { recursive: true, force: true });
    } catch (error) {
      this.logger.warn(`Konnte ${key} nicht löschen: ${String(error)}`);
    }
  }

  createReadStream(key: string, options?: { start?: number; end?: number }) {
    return createReadStream(this.resolveKey(key), options);
  }
}
