/**
 * Aufräumen (Phase 13).
 *
 * Über die Monate bleibt Zeug liegen: Dateien, deren Fassung längst gelöscht
 * ist, verbrauchte Anmeldecodes, abgebrochene Uploads. Nichts davon ist
 * dramatisch – aber ein Volume, das nur wächst, ist auf einer Synology
 * irgendwann ein Problem.
 *
 * Bewusst ein schlichter Timer statt eines Scheduler-Pakets: ein Prozess,
 * eine Aufgabe, kein zusätzlicher Baustein.
 */
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { and, isNotNull, lt, or } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import { loginCodes, projectFiles, videoVersions } from '../db/schema';
import { StorageService } from '../storage/storage.service';

/** Einmal am Tag genügt; der erste Lauf kommt kurz nach dem Start. */
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;

/**
 * So lange bleibt eine verwaiste Datei liegen, bevor sie fliegt. Die Karenz
 * schützt davor, dass gerade entstehende Dateien weggeräumt werden, während
 * die Datenbankzeile noch geschrieben wird.
 */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

export interface CleanupReport {
  loginCodes: number;
  orphanFiles: number;
  freedBytes: number;
}

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;
  private erstlauf: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  onModuleInit(): void {
    this.erstlauf = setTimeout(() => void this.runAll(), FIRST_RUN_DELAY_MS);
    this.erstlauf.unref();
    this.timer = setInterval(() => void this.runAll(), INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.erstlauf) clearTimeout(this.erstlauf);
    if (this.timer) clearInterval(this.timer);
  }

  async runAll(): Promise<CleanupReport> {
    try {
      const codes = await this.cleanupLoginCodes();
      const dateien = await this.cleanupOrphanFiles();

      if (codes > 0 || dateien.count > 0) {
        this.logger.log(
          `Aufgeräumt: ${codes} Anmeldecodes, ${dateien.count} verwaiste Dateien (${Math.round(dateien.bytes / 1024 / 1024)} MB).`,
        );
      }
      return { loginCodes: codes, orphanFiles: dateien.count, freedBytes: dateien.bytes };
    } catch (error) {
      this.logger.error(`Aufräumen fehlgeschlagen: ${String(error)}`);
      return { loginCodes: 0, orphanFiles: 0, freedBytes: 0 };
    }
  }

  /**
   * Abgelaufene und verbrauchte Anmeldecodes. Sie werden nicht mehr
   * gebraucht, enthalten aber E-Mail-Adressen – es gibt keinen Grund, sie zu
   * behalten.
   */
  async cleanupLoginCodes(): Promise<number> {
    const grenze = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.db
      .delete(loginCodes)
      .where(or(lt(loginCodes.expiresAt, grenze), and(isNotNull(loginCodes.consumedAt), lt(loginCodes.createdAt, grenze))))
      .returning({ id: loginCodes.id });
    return rows.length;
  }

  /**
   * Dateien im Volume, auf die keine Zeile mehr zeigt.
   *
   * Vorgehen: erst alle bekannten Schlüssel einsammeln, dann die
   * Verzeichnisse durchgehen. Das ist herum, aber richtig – umgekehrt (je
   * Datei eine Abfrage) wären es bei zehntausend Dateien zehntausend
   * Abfragen.
   */
  async cleanupOrphanFiles(): Promise<{ count: number; bytes: number }> {
    const bekannt = await this.knownKeys();
    const grenze = Date.now() - ORPHAN_GRACE_MS;

    let count = 0;
    let bytes = 0;

    for (const ordner of ['originals', 'proxies', 'posters', 'sprites', 'hls', 'project-files']) {
      for await (const eintrag of this.walk(ordner)) {
        // Bei HLS und Originalen zeigt die Datenbank aufs Verzeichnis bzw.
        // auf die Datei darin – deshalb zählt auch ein übergeordneter Treffer.
        if (bekannt.has(eintrag.key) || this.hasKnownAncestor(eintrag.key, bekannt)) continue;
        if (eintrag.mtimeMs > grenze) continue;

        await this.storage.remove(eintrag.key);
        count += 1;
        bytes += eintrag.size;
        this.logger.warn(`Verwaiste Datei entfernt: ${eintrag.key}`);
      }
    }

    return { count, bytes };
  }

  /** Alle Schlüssel, auf die noch irgendeine Zeile zeigt. */
  private async knownKeys(): Promise<Set<string>> {
    const keys = new Set<string>();

    const versionen = await this.db
      .select({
        originalKey: videoVersions.originalKey,
        proxyKey: videoVersions.proxyKey,
        posterKey: videoVersions.posterKey,
        spriteKey: videoVersions.spriteKey,
        hlsKey: videoVersions.hlsKey,
      })
      .from(videoVersions);

    for (const zeile of versionen) {
      for (const key of Object.values(zeile)) {
        if (key) keys.add(normalize(key));
      }
    }

    const dateien = await this.db.select({ key: projectFiles.storageKey }).from(projectFiles);
    for (const zeile of dateien) keys.add(normalize(zeile.key));

    // Laufende Uploads liegen unter tmp/ und werden vom Upload-Aufräumer
    // behandelt – hier bleiben sie außen vor.
    return keys;
  }

  /** Liegt die Datei unterhalb eines bekannten Verzeichnisses (HLS, Original)? */
  private hasKnownAncestor(key: string, bekannt: Set<string>): boolean {
    const teile = key.split('/');
    for (let laenge = teile.length - 1; laenge > 0; laenge -= 1) {
      if (bekannt.has(teile.slice(0, laenge).join('/'))) return true;
    }
    return false;
  }

  /** Läuft ein Verzeichnis rekursiv ab und meldet jede Datei. */
  private async *walk(
    relative: string,
  ): AsyncGenerator<{ key: string; size: number; mtimeMs: number }> {
    let eintraege: string[];
    try {
      eintraege = await readdir(this.storage.resolveKey(relative));
    } catch {
      return; // Verzeichnis gibt es (noch) nicht.
    }

    for (const name of eintraege) {
      const key = join(relative, name);
      let info: Awaited<ReturnType<typeof stat>>;
      try {
        info = await stat(this.storage.resolveKey(key));
      } catch {
        continue;
      }

      if (info.isDirectory()) {
        yield* this.walk(key);
      } else {
        yield { key: normalize(key), size: info.size, mtimeMs: info.mtimeMs };
      }
    }
  }
}

/** Vergleichbar machen: immer Schrägstriche, kein führender Schrägstrich. */
function normalize(key: string): string {
  return key.replace(/\\/g, '/').replace(/^\/+/, '');
}
