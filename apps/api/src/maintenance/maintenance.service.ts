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
import { and, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module';
import {
  deviceAuthorizations,
  loginCodes,
  notifications,
  pendingNotifications,
  projectFiles,
  projects,
  versionRenditions,
  videoVersions,
  videos,
} from '../db/schema';
import { MailQueueService } from '../queue/mail-queue.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';

/** Einmal am Tag genügt; der erste Lauf kommt kurz nach dem Start. */
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;

/**
 * So viele Tage vor dem Löschen wird gewarnt (Phase 28). Eine Woche: lang
 * genug, um noch etwas herunterzuladen oder das Projekt aus dem Archiv zu
 * holen, kurz genug, dass die Mail nicht in Vergessenheit gerät.
 */
const WARNUNG_VORLAUF_TAGE = 7;

/**
 * So lange bleibt eine verwaiste Datei liegen, bevor sie fliegt. Die Karenz
 * schützt davor, dass gerade entstehende Dateien weggeräumt werden, während
 * die Datenbankzeile noch geschrieben wird.
 */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * So lange darf eine Benachrichtigung auf ihre Sammelmail warten. Bleibt sie
 * länger liegen, hat der Versand dauerhaft nicht geklappt – dann ist der
 * Hinweis ohnehin überholt und die Zeile kann weg (Phase 18).
 */
const PENDING_NOTIFICATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * So lange bleibt ein **gelesener** Eintrag in der Zentrale stehen (Phase 29).
 *
 * Bisher sammelte sie nur an: Hinein ging alles, heraus nichts – gelesen hieß
 * bloß „nicht mehr fett". Eine Woche ist lang genug, um etwas noch einmal zu
 * suchen, und kurz genug, dass aus der Liste kein Archiv wird.
 *
 * Ungelesenes bleibt liegen, egal wie alt. Das ist gerade das, was noch
 * niemand angesehen hat – es nach einer Frist wegzuräumen hieße, eine
 * unerledigte Sache still zu erledigen.
 */
const GELESENE_BENACHRICHTIGUNG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CleanupReport {
  loginCodes: number;
  orphanFiles: number;
  freedBytes: number;
  pendingNotifications: number;
  /** Alte Fassungen archivierter Projekte (Phase 18). */
  archivedVersions: number;
  /** Abgelaufene Gerätekopplungen (Phase 27). */
  deviceAuthorizations: number;
  /** Längst gelesene Einträge der Zentrale (Phase 29). */
  readNotifications: number;
}

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private timer: NodeJS.Timeout | null = null;
  private erstlauf: NodeJS.Timeout | null = null;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly mailQueue: MailQueueService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
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

  /**
   * Ein Schritt, dessen Fehler hier endet.
   *
   * Vorher lag ein einziges `try` um den ganzen Lauf. Ein Fehler in der Mitte
   * riss damit alles Nachfolgende mit – und genau das geschah: Die
   * mehrdeutige Spalte in `warnBeforeCleanup` liess seit Phase 28 die beiden
   * Schritte danach nie laufen, darunter das Wegräumen verwaister Dateien.
   * Auf einem Medienserver ist das kein Schönheitsfehler.
   *
   * Ein Lauf, der zur Hälfte durchkommt, ist besser als keiner. Und der Name
   * im Log sagt, welche Hälfte fehlt – „Aufräumen fehlgeschlagen" allein sagt
   * das nicht, deshalb ist es so lange niemandem aufgefallen.
   */
  private async schritt<T>(name: string, aufgabe: () => Promise<T>, ersatz: T): Promise<T> {
    try {
      return await aufgabe();
    } catch (error) {
      this.logger.error(`Aufräumen – Schritt „${name}" fehlgeschlagen: ${String(error)}`);
      return ersatz;
    }
  }

  async runAll(): Promise<CleanupReport> {
    const codes = await this.schritt('Anmeldecodes', () => this.cleanupLoginCodes(), 0);
    const kopplungen = await this.schritt(
      'Gerätekopplungen',
      () => this.cleanupDeviceAuthorizations(),
      0,
    );
    const hinweise = await this.schritt(
      'liegengebliebene Benachrichtigungen',
      () => this.cleanupPendingNotifications(),
      0,
    );
    const gelesene = await this.schritt(
      'gelesene Einträge der Zentrale',
      () => this.cleanupReadNotifications(),
      0,
    );
    // Erst warnen, dann löschen: Sonst kommt die Warnung zu einem Verlust,
    // der schon eingetreten ist (Phase 28).
    await this.schritt('Warnung vor dem Aufräumen', () => this.warnBeforeCleanup(), 0);
    // Vor dem Datei-Durchlauf: Was hier wegfällt, ist danach verwaist und
    // wird im selben Lauf mit abgeräumt.
    const fassungen = await this.schritt(
      'alte Fassungen archivierter Projekte',
      () => this.cleanupArchivedVersions(),
      0,
    );
    const dateien = await this.schritt('verwaiste Dateien', () => this.cleanupOrphanFiles(), {
      count: 0,
      bytes: 0,
    });

    if (
      codes > 0 ||
      dateien.count > 0 ||
      hinweise > 0 ||
      gelesene > 0 ||
      fassungen > 0 ||
      kopplungen > 0
    ) {
      this.logger.log(
        `Aufgeräumt: ${codes} Anmeldecodes, ${kopplungen} abgelaufene Gerätekopplungen, ` +
          `${hinweise} liegengebliebene Benachrichtigungen, ` +
          `${gelesene} gelesene Einträge der Zentrale, ` +
          `${fassungen} alte Fassungen aus archivierten Projekten, ` +
          `${dateien.count} verwaiste Dateien (${Math.round(dateien.bytes / 1024 / 1024)} MB).`,
      );
    }
    return {
      loginCodes: codes,
      orphanFiles: dateien.count,
      freedBytes: dateien.bytes,
      pendingNotifications: hinweise,
      archivedVersions: fassungen,
      deviceAuthorizations: kopplungen,
      readNotifications: gelesene,
    };
  }

  /**
   * Gelesene Einträge der Zentrale nach ihrer Frist (Phase 29).
   *
   * `isNotNull` steht hier neben dem Vergleich, obwohl SQL eine `NULL` beim
   * Kleiner-als ohnehin nie trifft. Es ist die eigentliche Aussage dieser
   * Abfrage – dass Ungelesenes bleibt –, und die soll im Code stehen und
   * nicht aus der Dreiwertigkeit von SQL erschlossen werden müssen.
   */
  async cleanupReadNotifications(): Promise<number> {
    const schwelle = new Date(Date.now() - GELESENE_BENACHRICHTIGUNG_MAX_AGE_MS);
    const weg = await this.db
      .delete(notifications)
      .where(and(isNotNull(notifications.readAt), lt(notifications.readAt, schwelle)))
      .returning({ id: notifications.id });
    return weg.length;
  }

  /**
   * Alte Fassungen archivierter Projekte (Phase 18).
   *
   * Nach dem Archivieren bleiben sie noch die eingestellte Frist liegen –
   * falls das Archivieren ein Irrtum war. Danach fliegen sie, um Platz zu
   * schaffen. Die **neueste** Fassung je Video bleibt immer stehen; ohne sie
   * wäre das Projekt nicht mehr betrachtbar, und genau das soll es bleiben.
   *
   * Die Dateien selbst werden nicht hier gelöscht: Sie sind nach dem Wegfall
   * der Zeilen verwaist und gehen im selben Lauf durch `cleanupOrphanFiles`.
   */
  /**
   * Letzte Warnung vor dem Aufräumen (Phase 28).
   *
   * Das Löschen alter Fassungen archivierter Projekte ist der einzige
   * Vorgang, bei dem Klappe von sich aus Material entfernt – er soll nicht
   * unangekündigt kommen. Gewarnt wird, sobald die Frist in weniger als einer
   * Woche abläuft, und **einmal je Projekt**: Der Zeitstempel in
   * `cleanup_warned_at` verhindert, dass daraus eine tägliche Mahnung wird.
   */
  async warnBeforeCleanup(): Promise<number> {
    const tage = await this.settings.archiveRetentionDays();
    // Eine Frist von 0 heißt „sofort" – dafür gibt es kein Vorher.
    if (tage <= 0) return 0;

    const vorlauf = Math.min(WARNUNG_VORLAUF_TAGE, tage);
    const schwelle = new Date(Date.now() - (tage - vorlauf) * 24 * 60 * 60 * 1000);

    const faellig = await this.db
      .select({
        id: projects.id,
        archivedAt: projects.archivedAt,
        /*
         * Der Bezug auf das äußere Projekt steht ausgeschrieben als
         * `projects.id` und nicht als eingesetzte Spalte: Drizzle macht aus
         * einer eingesetzten Spalte nur `"id"`, ohne die Tabelle davor. In
         * dieser Unterabfrage sind aber `video_versions v` und `videos w` im
         * Blick, und beide haben eine Spalte `id` – Postgres wies die ganze
         * Abfrage als mehrdeutig zurück, und seit Phase 28 scheiterte damit
         * jeder Aufräumlauf an dieser Stelle.
         *
         * Die Erklärung steht außerhalb des Templates, nicht darin: Ein
         * Backtick im Text würde das Template beenden.
         */
        betroffen: sql<number>`(
          select count(*)::int
          from ${videoVersions} v
          join ${videos} w on w.id = v.video_id
          where w.project_id = projects.id
            and v.id <> (
              select v2.id from ${videoVersions} v2
              where v2.video_id = w.id and v2.status = 'READY'
              order by v2.version_number desc
              limit 1
            )
        )`,
      })
      .from(projects)
      .where(
        and(
          isNotNull(projects.archivedAt),
          lt(projects.archivedAt, schwelle),
          isNull(projects.cleanupWarnedAt),
        ),
      );

    let gewarnt = 0;
    for (const projekt of faellig) {
      // Nichts zu verlieren, nichts zu warnen – der Vermerk wird trotzdem
      // gesetzt, sonst läuft die Abfrage täglich gegen dasselbe Projekt.
      if (projekt.betroffen > 0 && projekt.archivedAt) {
        const restMs = projekt.archivedAt.getTime() + tage * 86_400_000 - Date.now();
        await this.mailQueue.enqueue({
          kind: 'cleanup-warning',
          projectId: projekt.id,
          days: Math.max(0, Math.ceil(restMs / 86_400_000)),
          versionCount: projekt.betroffen,
        });
        gewarnt += 1;
      }
      await this.db
        .update(projects)
        .set({ cleanupWarnedAt: new Date() })
        .where(eq(projects.id, projekt.id));
    }
    return gewarnt;
  }

  async cleanupArchivedVersions(): Promise<number> {
    const tage = await this.settings.archiveRetentionDays();
    const grenze = new Date(Date.now() - tage * 24 * 60 * 60 * 1000);

    const rows = await this.db
      .delete(videoVersions)
      .where(
        sql`${videoVersions.id} in (
          select v.id
          from ${videoVersions} v
          join ${videos} w on w.id = v.video_id
          join ${projects} p on p.id = w.project_id
          where p.archived_at is not null
            and p.archived_at < ${grenze}
            and v.id <> (
              select v2.id from ${videoVersions} v2
              where v2.video_id = w.id and v2.status = 'READY'
              order by v2.version_number desc
              limit 1
            )
        )`,
      )
      .returning({ id: videoVersions.id });

    if (rows.length > 0) {
      this.logger.warn(
        `${rows.length} alte Fassung(en) aus archivierten Projekten entfernt (Frist: ${tage} Tage).`,
      );
    }
    return rows.length;
  }

  /**
   * Vorgemerkte Benachrichtigungen, die nie zugestellt werden konnten. Die
   * Warteschlange gibt nach ein paar Versuchen auf; ohne diesen Kehraus
   * blieben die Zeilen für immer stehen.
   */
  async cleanupPendingNotifications(): Promise<number> {
    const grenze = new Date(Date.now() - PENDING_NOTIFICATION_MAX_AGE_MS);
    const rows = await this.db
      .delete(pendingNotifications)
      .where(lt(pendingNotifications.createdAt, grenze))
      .returning({ id: pendingNotifications.id });
    return rows.length;
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
   * Abgelaufene Gerätekopplungen (Phase 27).
   *
   * Eine Kopplung gilt zehn Minuten. Was danach übrig bleibt, ist wertlos –
   * der Klartext-Token ist beim Abholen ohnehin gelöscht worden. Dieselbe
   * Karenz von einem Tag wie bei den Anmeldecodes: Wer sich fragt, warum das
   * Verbinden eben nicht geklappt hat, soll die Zeile im Zweifel noch
   * vorfinden.
   */
  async cleanupDeviceAuthorizations(): Promise<number> {
    const grenze = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await this.db
      .delete(deviceAuthorizations)
      .where(lt(deviceAuthorizations.expiresAt, grenze))
      .returning({ id: deviceAuthorizations.id });
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

    for (const ordner of [
      'originals',
      'proxies',
      'posters',
      'sprites',
      'hls',
      'project-files',
      // Download-Formate (Phase 19). Hier landet auch, was nach einer
      // Preset-Änderung stehen geblieben ist – die Zeile zeigt dann auf eine
      // neue Datei, die alte ist verwaist.
      'renditions',
    ]) {
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

    const formate = await this.db
      .select({ key: versionRenditions.storageKey })
      .from(versionRenditions);
    for (const zeile of formate) {
      if (zeile.key) keys.add(normalize(zeile.key));
    }

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
