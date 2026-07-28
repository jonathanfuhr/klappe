import { Inject, Injectable, Logger } from '@nestjs/common';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { AppConfig, CONFIG } from '../config/configuration';

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
   * Datei im Kunden-Ordner eines Projekts. Die Upload-ID im Pfad verhindert,
   * dass zwei gleichnamige Dateien einander überschreiben.
   */
  keyForProjectFile(projectId: string, uploadId: string, filename: string): string {
    return join('project-files', projectId, `${uploadId}-${filename}`);
  }

  /**
   * Logo des Workspace. Die Endung steckt im Namen, damit beim Wechsel von
   * SVG auf PNG nicht die alte Datei liegen bleibt und ausgeliefert wird.
   */
  keyForBrandLogo(extension: string): string {
    return join('branding', `logo.${extension}`);
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
