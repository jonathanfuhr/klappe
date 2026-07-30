/**
 * Datenbanksicherung (Phase 23).
 *
 * Gesichert wird **nur die Datenbank**: Projekte, Kommentare, Freigaben,
 * Einstellungen. Die Mediendateien bleiben außen vor – sie liegen im selben
 * Volume, und ein Abzug davon wäre keine Sicherung, sondern eine zweite Kopie
 * am selben Ort. Wer Medien sichern will, sichert das Volume; das steht so
 * auch im README.
 *
 * Die Dateien landen in einem Unterordner der Ablage. Der tägliche Aufräumer
 * lässt sie in Ruhe: Er geht eine feste Liste von Verzeichnissen durch, und
 * `backups` steht nicht darin.
 */
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { BackupFileDto, BackupSettingsDto } from '@klappe/shared';
import {
  MAX_BACKUP_INTERVAL_HOURS,
  MAX_BACKUP_RETENTION_DAYS,
  MIN_BACKUP_INTERVAL_HOURS,
} from '@klappe/shared';
import { execFile } from 'node:child_process';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { appSettings } from '../db/schema';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';

const ausfuehren = promisify(execFile);

const SETTINGS_ID = 1;

/** Unterordner der Ablage, in dem die Sicherungen liegen. */
const ORDNER = 'backups';

/**
 * Ein Dump darf dauern – bei einer großen Datenbank sind ein paar Minuten
 * normal –, aber nicht ewig. Läuft er länger, stimmt etwas nicht.
 */
const TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Streng, weil der Name aus einer Anfrage kommt und gleich in einen Pfad
 * wandert: nur das, was `dateiname()` selbst erzeugt.
 */
const NAME_MUSTER = /^klappe-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-vor-restore)?\.dump$/;

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  /** Verhindert, dass zwei Läufe gleichzeitig in dasselbe Verzeichnis schreiben. */
  private laeuft = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  // ---------- Einstellungen ----------

  async getSettings(): Promise<BackupSettingsDto> {
    const row = await this.settings.getRow();
    return {
      enabled: row.backupEnabled,
      intervalHours: row.backupIntervalHours,
      retentionDays: row.backupRetentionDays,
      lastRunAt: row.backupLastRunAt?.toISOString() ?? null,
      lastError: row.backupLastError,
      directory: this.verzeichnis(),
      toolsAvailable: await this.werkzeugeVorhanden(),
    };
  }

  async updateSettings(input: {
    enabled?: boolean;
    intervalHours?: number;
    retentionDays?: number;
  }): Promise<BackupSettingsDto> {
    await this.settings.getRow();
    await this.db
      .update(appSettings)
      .set({
        backupEnabled: input.enabled,
        backupIntervalHours:
          input.intervalHours === undefined
            ? undefined
            : Math.max(
                MIN_BACKUP_INTERVAL_HOURS,
                Math.min(MAX_BACKUP_INTERVAL_HOURS, Math.round(input.intervalHours)),
              ),
        backupRetentionDays:
          input.retentionDays === undefined
            ? undefined
            : Math.max(0, Math.min(MAX_BACKUP_RETENTION_DAYS, Math.round(input.retentionDays))),
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));
    return this.getSettings();
  }

  // ---------- Dateien ----------

  /** Die abgelegten Sicherungen, neueste zuerst. */
  async list(): Promise<BackupFileDto[]> {
    const verzeichnis = this.verzeichnis();
    let namen: string[];
    try {
      namen = await readdir(verzeichnis);
    } catch {
      // Noch nie gesichert – kein Fehler, nur nichts da.
      return [];
    }

    const dateien: BackupFileDto[] = [];
    for (const name of namen) {
      if (!NAME_MUSTER.test(name)) continue;
      try {
        const info = await stat(join(verzeichnis, name));
        dateien.push({
          name,
          sizeBytes: info.size,
          createdAt: info.mtime.toISOString(),
        });
      } catch {
        // Zwischen readdir und stat gelöscht – dann eben nicht.
      }
    }

    return dateien.sort((links, rechts) => rechts.createdAt.localeCompare(links.createdAt));
  }

  async remove(name: string): Promise<void> {
    const pfad = this.pfadFuer(name);
    await rm(pfad, { force: true });
    this.logger.log(`Sicherung gelöscht: ${name}`);
  }

  // ---------- Sichern ----------

  /**
   * Einen Dump ziehen. Läuft schon einer, passiert nichts – zwei gleichzeitig
   * brächten nur zwei halbe Dateien.
   *
   * Format `custom` (`-Fc`): komprimiert, und beim Einspielen erlaubt
   * `pg_restore` damit `--clean --if-exists`, ohne dass diese Entscheidung
   * schon in der Datei stecken muss.
   */
  async run(options: { suffix?: string } = {}): Promise<BackupFileDto> {
    if (this.laeuft) {
      throw new BadRequestException('Es läuft bereits eine Sicherung.');
    }
    this.laeuft = true;
    const verzeichnis = this.verzeichnis();
    const name = this.dateiname(options.suffix);
    const pfad = join(verzeichnis, name);

    try {
      await mkdir(verzeichnis, { recursive: true });
      await ausfuehren(
        'pg_dump',
        ['--format=custom', '--no-owner', '--no-acl', '--file', pfad, this.config.databaseUrl],
        { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      );

      const info = await stat(pfad);
      await this.vermerke(null);
      this.logger.log(`Sicherung geschrieben: ${name} (${info.size} Bytes)`);
      return { name, sizeBytes: info.size, createdAt: info.mtime.toISOString() };
    } catch (error) {
      // Eine halb geschriebene Datei sähe in der Liste aus wie eine gültige
      // Sicherung – das wäre schlimmer als gar keine.
      await rm(pfad, { force: true }).catch(() => undefined);
      const meldung = this.meldung(error);
      await this.vermerke(meldung);
      this.logger.error(`Sicherung fehlgeschlagen: ${meldung}`);
      throw new BadRequestException(`Die Sicherung ist fehlgeschlagen: ${meldung}`);
    } finally {
      this.laeuft = false;
    }
  }

  /** Alte Sicherungen wegräumen; `0 Tage` heißt „nur die neueste behalten". */
  async cleanup(): Promise<number> {
    const { retentionDays } = await this.getSettings();
    const dateien = await this.list();
    if (dateien.length <= 1) return 0;

    const grenze = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let entfernt = 0;

    // Die neueste bleibt immer stehen, auch wenn sie älter als die Frist ist.
    // Eine abgelaufene Sicherung ist besser als keine.
    for (const datei of dateien.slice(1)) {
      if (new Date(datei.createdAt).getTime() >= grenze) continue;
      await this.remove(datei.name);
      entfernt += 1;
    }
    return entfernt;
  }

  // ---------- Wiederherstellen ----------

  /**
   * Eine Sicherung einspielen.
   *
   * Zuvor entsteht **immer** ein frischer Dump des jetzigen Standes. Wer sich
   * in der Datei vertut, hat sonst keinen Weg zurück – und genau in dieser
   * Lage greift man zu dieser Funktion.
   *
   * `pg_restore --clean --if-exists` wirft die vorhandenen Tabellen weg und
   * legt sie neu an. Danach gehört der Stapel neu gestartet: Die laufenden
   * Prozesse halten Verbindungen und Zwischenstände, die zur alten Datenbank
   * gehören.
   */
  async restore(name: string): Promise<{ sicherungVorher: string }> {
    const pfad = this.pfadFuer(name);
    await stat(pfad).catch(() => {
      throw new BadRequestException('Diese Sicherung gibt es nicht.');
    });

    const vorher = await this.run({ suffix: 'vor-restore' });

    try {
      await ausfuehren(
        'pg_restore',
        [
          '--clean',
          '--if-exists',
          '--no-owner',
          '--no-acl',
          // Ohne das bricht der Lauf beim ersten `DROP … IF EXISTS` ab, das
          // nichts vorfindet – bei einer frischen Datenbank also sofort.
          '--exit-on-error',
          '--dbname',
          this.config.databaseUrl,
          pfad,
        ],
        { timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      );
    } catch (error) {
      const meldung = this.meldung(error);
      this.logger.error(`Wiederherstellung fehlgeschlagen: ${meldung}`);
      throw new BadRequestException(
        `Die Wiederherstellung ist fehlgeschlagen: ${meldung} — der Stand von vorher liegt als „${vorher.name}“ bereit.`,
      );
    }

    this.logger.warn(`Datenbank aus „${name}" wiederhergestellt.`);
    return { sicherungVorher: vorher.name };
  }

  // ---------- Hilfsmittel ----------

  /** Steht `pg_dump` überhaupt zur Verfügung? */
  async werkzeugeVorhanden(): Promise<boolean> {
    try {
      await ausfuehren('pg_dump', ['--version'], { timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Wann der nächste Lauf fällig ist – `null`, solange abgeschaltet. */
  async naechsterLauf(): Promise<Date | null> {
    const row = await this.settings.getRow();
    if (!row.backupEnabled) return null;
    if (!row.backupLastRunAt) return new Date();
    return new Date(row.backupLastRunAt.getTime() + row.backupIntervalHours * 60 * 60 * 1000);
  }

  private verzeichnis(): string {
    return this.storage.resolveKey(ORDNER);
  }

  /**
   * Dateiname → Pfad, mit derselben Strenge wie überall in der Ablage: Der
   * Name kommt aus einer Anfrage und darf nicht aus dem Ordner führen.
   */
  private pfadFuer(name: string): string {
    if (!NAME_MUSTER.test(name)) {
      throw new BadRequestException('Das ist kein Name einer Sicherung.');
    }
    const pfad = resolve(this.verzeichnis(), name);
    if (!pfad.startsWith(this.verzeichnis())) {
      throw new BadRequestException('Das ist kein Name einer Sicherung.');
    }
    return pfad;
  }

  /** `klappe-2026-07-30T14-05-00.dump` – sortierbar und ohne Doppelpunkte. */
  private dateiname(suffix?: string): string {
    const stempel = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    return `klappe-${stempel}${suffix ? `-${suffix}` : ''}.dump`;
  }

  private async vermerke(fehler: string | null): Promise<void> {
    await this.db
      .update(appSettings)
      .set({
        // Nur bei Erfolg fortschreiben: Sonst gälte ein gescheiterter Lauf als
        // erledigt und der nächste käme erst ein Intervall später.
        backupLastRunAt: fehler === null ? new Date() : undefined,
        backupLastError: fehler,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));
  }

  /** Aus einem `execFile`-Fehler das herausziehen, was weiterhilft. */
  private meldung(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'stderr' in error) {
      const stderr = String((error as { stderr: unknown }).stderr).trim();
      if (stderr) return stderr.split('\n').slice(-3).join(' ').slice(0, 500);
    }
    if (error instanceof Error) {
      // Fehlt das Werkzeug, ist die nackte Meldung „ENOENT" wenig hilfreich.
      if ('code' in error && (error as { code?: string }).code === 'ENOENT') {
        return 'pg_dump ist in diesem Container nicht vorhanden.';
      }
      return error.message.slice(0, 500);
    }
    return String(error).slice(0, 500);
  }
}
