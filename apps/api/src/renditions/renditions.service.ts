import { BadRequestException, Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import {
  buildDownloadFilename,
  extensionOf,
  fileDateFromIso,
  type RenditionContainer,
  type VersionDownloadsDto,
  type VersionRenditionDto,
} from '@klappe/shared';
import { and, eq } from 'drizzle-orm';
import { AccessService, type AccessScope } from '../access/access.service';
import { DB, type Database } from '../db/db.module';
import {
  downloadPresets,
  projects,
  videoVersions,
  versionRenditions,
  videos,
  type DownloadPresetRow,
  type VersionRenditionRow,
} from '../db/schema';
import { EventsService } from '../events/events.service';
import { TranscodeQueueService } from '../queue/transcode-queue.service';
import { TranscodeSettingsService } from '../settings/transcode-settings.service';
import { StorageService } from '../storage/storage.service';
import { resolutionLabel } from '../transcode/media-plan';
import { planRendition, renditionSignature } from '../transcode/rendition-plan';
import { delayUntilWindow } from '../transcode/transcode-window';

/** Alles, was der Worker zu einem Auftrag braucht. */
export interface RenditionJob {
  rendition: VersionRenditionRow;
  preset: DownloadPresetRow;
  version: typeof videoVersions.$inferSelect;
}

/**
 * Download in verschiedenen Formaten (Phase 19).
 *
 * Der Admin legt Formate an, der Kunde wählt eines aus. Fehlt die Datei noch,
 * entsteht sie beim Klick – mit Fortschrittsbalken, denn ein 4K-Original
 * herunterzurechnen dauert. Ist sie schon da (etwa weil die Vorab-Erzeugung
 * eingeschaltet ist), geht es sofort los.
 *
 * Erzeugt wird immer aus dem **Original**, nie aus der Abspielfassung: Ein
 * Proxy ist bereits einmal kodiert, ein zweiter Durchlauf darüber würde nur
 * Fehler verstärken.
 */
@Injectable()
export class RenditionsService {
  private readonly logger = new Logger(RenditionsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly accessService: AccessService,
    private readonly settings: TranscodeSettingsService,
    private readonly queue: TranscodeQueueService,
    private readonly storage: StorageService,
    private readonly events: EventsService,
  ) {}

  // ---------- Anzeige ----------

  /** Was das Download-Fenster einer Fassung anbietet. */
  async listForVersion(versionId: string, scope: AccessScope): Promise<VersionDownloadsDto> {
    const zugang = await this.accessService.requireVersion(scope, versionId);
    const darfLaden = this.accessService.canDownload(scope, zugang);
    const kontext = await this.loadKontext(versionId);
    const einstellungen = await this.settings.effective();

    const basis: VersionDownloadsDto = {
      formatsEnabled: einstellungen.downloadFormatsEnabled,
      canDownload: darfLaden,
      originalFilename: this.dateiname(kontext, null),
      originalSizeBytes: kontext.version.originalSizeBytes,
      renditions: [],
    };
    if (!einstellungen.downloadFormatsEnabled || !darfLaden) return basis;

    const presets = await this.db
      .select()
      .from(downloadPresets)
      .where(eq(downloadPresets.isActive, true))
      .orderBy(downloadPresets.sortOrder, downloadPresets.createdAt);

    const vorhanden = await this.db
      .select()
      .from(versionRenditions)
      .where(eq(versionRenditions.versionId, versionId));
    const nachPreset = new Map(vorhanden.map((row) => [row.presetId, row]));

    basis.renditions = presets.map((preset) =>
      this.toDto(preset, nachPreset.get(preset.id) ?? null, kontext),
    );
    return basis;
  }

  // ---------- Anfordern ----------

  /**
   * Ein Format anfordern. Ist es schon fertig und passt es noch zum Preset,
   * kommt es unverändert zurück – sonst wird ein Auftrag eingereiht.
   */
  async request(
    versionId: string,
    presetId: string,
    userId: string,
    scope: AccessScope,
  ): Promise<VersionRenditionDto> {
    const zugang = await this.accessService.requireVersion(scope, versionId);
    this.accessService.assertCanDownload(scope, zugang);

    const einstellungen = await this.settings.effective();
    if (!einstellungen.downloadFormatsEnabled) {
      throw new BadRequestException('Die Formatauswahl ist ausgeschaltet.');
    }

    const kontext = await this.loadKontext(versionId);
    if (kontext.version.status !== 'READY' || !kontext.version.originalKey) {
      throw new BadRequestException('Diese Fassung ist noch nicht fertig verarbeitet.');
    }

    const [preset] = await this.db
      .select()
      .from(downloadPresets)
      .where(and(eq(downloadPresets.id, presetId), eq(downloadPresets.isActive, true)))
      .limit(1);
    if (!preset) throw new NotFoundException('Dieses Format gibt es nicht (mehr).');

    const row = await this.ensureRendition(versionId, preset, userId, { angefordert: true });
    return this.toDto(preset, row, kontext);
  }

  /**
   * Die fertige Datei zum Ausliefern. Wirft, solange sie noch entsteht – der
   * Aufrufer soll dann den Fortschritt zeigen, nicht eine halbe Datei
   * herunterladen.
   */
  async fileFor(
    versionId: string,
    presetId: string,
    scope: AccessScope,
  ): Promise<{ key: string; filename: string; container: RenditionContainer }> {
    const zugang = await this.accessService.requireVersion(scope, versionId);
    this.accessService.assertCanDownload(scope, zugang);

    const [treffer] = await this.db
      .select({ rendition: versionRenditions, preset: downloadPresets })
      .from(versionRenditions)
      .innerJoin(downloadPresets, eq(versionRenditions.presetId, downloadPresets.id))
      .where(
        and(eq(versionRenditions.versionId, versionId), eq(versionRenditions.presetId, presetId)),
      )
      .limit(1);

    if (!treffer || treffer.rendition.status !== 'READY' || !treffer.rendition.storageKey) {
      throw new NotFoundException('Diese Fassung ist noch nicht fertig.');
    }
    if (treffer.rendition.signature !== renditionSignature(treffer.preset)) {
      throw new NotFoundException('Das Format wurde geändert – die Fassung wird neu erzeugt.');
    }

    const kontext = await this.loadKontext(versionId);
    return {
      key: treffer.rendition.storageKey,
      filename: this.dateiname(kontext, {
        preset: treffer.preset,
        rendition: treffer.rendition,
      }),
      container: (treffer.preset.container as RenditionContainer) ?? 'mp4',
    };
  }

  // ---------- Vorrat ----------

  /**
   * Nach der Verarbeitung einer Fassung die Formate im Voraus erzeugen –
   * sofern eingeschaltet. Läuft mit niedrigem Vorrang und, wenn ein
   * Zeitfenster gesetzt ist, erst darin.
   */
  async prebuildFor(versionId: string): Promise<number> {
    const einstellungen = await this.settings.effective();
    // `on-demand` heißt: gar nicht im Voraus, erst wenn jemand klickt.
    if (!einstellungen.downloadFormatsEnabled) return 0;
    if (einstellungen.downloadTiming === 'on-demand') return 0;

    const [version] = await this.db
      .select()
      .from(videoVersions)
      .where(eq(videoVersions.id, versionId))
      .limit(1);
    if (!version || version.status !== 'READY' || !version.originalKey) return 0;
    if (einstellungen.downloadFinalOnly && !version.isFinal) return 0;

    const presets = await this.db
      .select()
      .from(downloadPresets)
      .where(eq(downloadPresets.isActive, true));
    if (presets.length === 0) return 0;

    const delayMs = delayUntilWindow(new Date(), einstellungen.downloadWindow);
    let eingereiht = 0;
    for (const preset of presets) {
      const vorher = await this.findRendition(versionId, preset.id);
      // Was schon passt oder gerade läuft, bleibt in Ruhe.
      if (vorher && vorher.signature === renditionSignature(preset)) {
        if (vorher.status === 'READY' || vorher.status === 'PROCESSING') continue;
        if (vorher.status === 'QUEUED') continue;
      }
      await this.ensureRendition(versionId, preset, null, { angefordert: false, delayMs });
      eingereiht += 1;
    }

    if (eingereiht > 0) {
      this.logger.log(`Vorab-Erzeugung eingereiht: ${eingereiht} Format(e) für ${versionId}`);
    }
    return eingereiht;
  }

  // ---------- Worker ----------

  async loadJob(renditionId: string): Promise<RenditionJob | null> {
    const [treffer] = await this.db
      .select({
        rendition: versionRenditions,
        preset: downloadPresets,
        version: videoVersions,
      })
      .from(versionRenditions)
      .innerJoin(downloadPresets, eq(versionRenditions.presetId, downloadPresets.id))
      .innerJoin(videoVersions, eq(versionRenditions.versionId, videoVersions.id))
      .where(eq(versionRenditions.id, renditionId))
      .limit(1);
    return treffer ?? null;
  }

  async setProcessing(renditionId: string): Promise<void> {
    await this.db
      .update(versionRenditions)
      .set({ status: 'PROCESSING', progress: 0, error: null, startedAt: new Date(), updatedAt: new Date() })
      .where(eq(versionRenditions.id, renditionId));
    await this.melde(renditionId);
  }

  async setProgress(renditionId: string, prozent: number): Promise<void> {
    const wert = Math.max(0, Math.min(100, Math.round(prozent)));
    await this.db
      .update(versionRenditions)
      .set({ progress: wert })
      .where(eq(versionRenditions.id, renditionId));
  }

  async finish(
    renditionId: string,
    ergebnis: { storageKey: string; sizeBytes: number; width: number; height: number },
  ): Promise<void> {
    await this.db
      .update(versionRenditions)
      .set({
        status: 'READY',
        progress: 100,
        error: null,
        storageKey: ergebnis.storageKey,
        sizeBytes: ergebnis.sizeBytes,
        width: ergebnis.width,
        height: ergebnis.height,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(versionRenditions.id, renditionId));
    await this.melde(renditionId);
  }

  async markFailed(renditionId: string, message: string): Promise<void> {
    await this.db
      .update(versionRenditions)
      .set({
        status: 'FAILED',
        error: message.slice(0, 2000),
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(versionRenditions.id, renditionId));
    await this.melde(renditionId);
  }

  // ---------- Innereien ----------

  /**
   * Sorgt dafür, dass es für Fassung und Preset eine Zeile gibt, die zum
   * aktuellen Preset passt – und reiht einen Auftrag ein, wenn nötig.
   *
   * Passt die Unterschrift nicht mehr (der Admin hat das Format geändert),
   * wird die alte Datei weggeräumt und neu erzeugt. Eine Datei auszuliefern,
   * die mit dem gewählten Format nichts mehr zu tun hat, wäre schlimmer als
   * ein paar Minuten Warten.
   */
  private async ensureRendition(
    versionId: string,
    preset: DownloadPresetRow,
    userId: string | null,
    optionen: { angefordert: boolean; delayMs?: number },
  ): Promise<VersionRenditionRow> {
    const signatur = renditionSignature(preset);
    const vorher = await this.findRendition(versionId, preset.id);

    if (vorher && vorher.signature === signatur) {
      if (vorher.status === 'READY' && vorher.storageKey) return vorher;
      if (vorher.status === 'PROCESSING') return vorher;
      if (vorher.status === 'QUEUED') {
        // Wartet noch im Vorrat und jemand will sie jetzt: nach vorn holen.
        if (optionen.angefordert) {
          await this.queue.enqueueRendition(vorher.id, { angefordert: true });
        }
        return vorher;
      }
    }

    if (vorher?.storageKey) await this.storage.remove(vorher.storageKey);

    const werte = {
      status: 'QUEUED' as const,
      progress: 0,
      error: null,
      signature: signatur,
      storageKey: null,
      sizeBytes: null,
      width: null,
      height: null,
      requestedById: userId,
      startedAt: null,
      finishedAt: null,
      updatedAt: new Date(),
    };

    const [row] = vorher
      ? await this.db
          .update(versionRenditions)
          .set(werte)
          .where(eq(versionRenditions.id, vorher.id))
          .returning()
      : await this.db
          .insert(versionRenditions)
          .values({ versionId, presetId: preset.id, ...werte })
          .returning();

    await this.queue.enqueueRendition(row.id, optionen);
    await this.melde(row.id);
    return row;
  }

  private async findRendition(
    versionId: string,
    presetId: string,
  ): Promise<VersionRenditionRow | null> {
    const [row] = await this.db
      .select()
      .from(versionRenditions)
      .where(
        and(eq(versionRenditions.versionId, versionId), eq(versionRenditions.presetId, presetId)),
      )
      .limit(1);
    return row ?? null;
  }

  /** Fassung samt Video und Projekt – für den Dateinamen. */
  private async loadKontext(versionId: string) {
    const [row] = await this.db
      .select({
        version: videoVersions,
        videoName: videos.name,
        projectName: projects.name,
        projectCustomer: projects.customer,
      })
      .from(videoVersions)
      .innerJoin(videos, eq(videoVersions.videoId, videos.id))
      .innerJoin(projects, eq(videos.projectId, projects.id))
      .where(eq(videoVersions.id, versionId))
      .limit(1);
    if (!row) throw new NotFoundException('Version nicht gefunden.');
    return row;
  }

  /**
   * Dateiname nach dem gewohnten Schema. Für ein Format steht dessen
   * Auflösung darin, nicht die des Originals – sonst hieße die 720p-Datei
   * `…_2160p25.mp4`.
   */
  private dateiname(
    kontext: Awaited<ReturnType<RenditionsService['loadKontext']>>,
    format: { preset: DownloadPresetRow; rendition: VersionRenditionRow | null } | null,
  ): string {
    const version = kontext.version;
    const frameRate =
      version.fpsNum && version.fpsDen ? { num: version.fpsNum, den: version.fpsDen } : null;

    // Solange die Datei noch nicht da ist, wird die Zielgröße vorausberechnet,
    // damit im Fenster schon der richtige Name steht.
    const geplant =
      format && version.width && version.height
        ? planRendition(version.width, version.height, format.preset)
        : null;
    const breite = format?.rendition?.width ?? geplant?.width ?? version.width;
    const hoehe = format?.rendition?.height ?? geplant?.height ?? version.height;

    return buildDownloadFilename({
      date: fileDateFromIso(version.fileDate),
      customer: kontext.projectCustomer ?? null,
      projectName: kontext.projectName ?? 'Projekt',
      videoName: kontext.videoName ?? 'Video',
      versionNumber: Number(version.versionNumber),
      isFinal: version.isFinal,
      resolution: resolutionLabel(breite, hoehe, frameRate),
      extension: format ? format.preset.container : extensionOf(version.originalFilename),
    });
  }

  private toDto(
    preset: DownloadPresetRow,
    rendition: VersionRenditionRow | null,
    kontext: Awaited<ReturnType<RenditionsService['loadKontext']>>,
  ): VersionRenditionDto {
    // Eine Zeile aus einer alten Preset-Fassung zählt nicht als vorhanden –
    // sie wird beim nächsten Anfordern ohnehin neu erzeugt.
    const gueltig =
      rendition && rendition.signature === renditionSignature(preset) ? rendition : null;

    return {
      presetId: preset.id,
      name: preset.name,
      shortEdge: preset.shortEdge,
      container: (preset.container as RenditionContainer) ?? 'mp4',
      status: gueltig?.status ?? null,
      progress: gueltig?.progress ?? 0,
      error: gueltig?.error ?? null,
      sizeBytes: gueltig?.sizeBytes ?? null,
      width: gueltig?.width ?? null,
      height: gueltig?.height ?? null,
      downloadFilename: this.dateiname(kontext, { preset, rendition: gueltig }),
    };
  }

  /** Die Oberfläche lädt danach über den gewohnten Weg nach. */
  private async melde(renditionId: string): Promise<void> {
    const [row] = await this.db
      .select({ videoId: videos.id, projectId: videos.projectId })
      .from(versionRenditions)
      .innerJoin(videoVersions, eq(versionRenditions.versionId, videoVersions.id))
      .innerJoin(videos, eq(videoVersions.videoId, videos.id))
      .where(eq(versionRenditions.id, renditionId))
      .limit(1);
    if (row) this.events.publish({ topic: 'video', id: row.videoId, projectId: row.projectId });
  }
}
