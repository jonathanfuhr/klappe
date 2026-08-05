/**
 * Die Einstellungen der awork-Anbindung (Phase 30).
 *
 * Liegen wie alles andere in der einen Zeile `app_settings`; dieser Dienst ist
 * die Sicht darauf. Er kennt den API-Schlüssel im Klartext – deshalb steht
 * hier auch die Regel, dass er eine Antwort nie verlässt.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  type AworkEvent,
  type AworkSettingsDto,
  MAX_AWORK_EXCLUDE_TERMS,
  MAX_AWORK_TASK_LIST_NAME,
  MAX_AWORK_TASK_TITLE_PREFIX,
  aworkEvents,
} from '@klappe/shared';
import { eq, sql } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { type AppSettingsRow, appSettings, projectFieldDefs } from '../db/schema';
import { SETTINGS_ID, SettingsService } from '../settings/settings.service';
import { parseProjektTypen } from './matching';

export interface UpdateAworkSettingsInput {
  enabled?: boolean;
  /** `undefined` = unverändert, `null` = löschen, sonst neuer Schlüssel. */
  apiKey?: string | null;
  projectKeyFieldId?: string | null;
  projectNumberFieldId?: string | null;
  aworkProjectNumberFieldId?: string | null;
  projectTypes?: string[] | null;
  taskListName?: string;
  taskTitlePrefix?: string;
  fallbackUserId?: string | null;
  autoCreateProjects?: boolean;
  writeBackLink?: boolean;
  syncProjectNumber?: boolean;
  excludeTerms?: string | null;
  events?: Array<{ event: AworkEvent; enabled: boolean }>;
}

/**
 * Name des Klappe-Felds, in dem der awork-Projekt-Key steht. Wird beim
 * Einschalten der Anbindung angelegt, falls es fehlt.
 */
export const AWORK_KEY_FELDNAME = 'awork-Projekt-Key';

/** Spalte je Ereignis – die eine Stelle, an der die Zuordnung steht. */
const EREIGNIS_SPALTEN = {
  kundenmaterial: 'aworkEventKundenmaterial',
  erstbesuch: 'aworkEventErstbesuch',
  'fassung-verfuegbar': 'aworkEventFassungVerfuegbar',
  endfassung: 'aworkEventEndfassung',
  'aufgabe-erledigen': 'aworkEventAufgabeErledigen',
} as const satisfies Partial<Record<AworkEvent, keyof AppSettingsRow>>;

@Injectable()
export class AworkSettingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly settings: SettingsService,
  ) {}

  async get(): Promise<AworkSettingsDto> {
    const row = await this.settings.getRow();
    return {
      enabled: row.aworkEnabled,
      hasApiKey: Boolean(row.aworkApiKeyEncrypted),
      projectKeyFieldId: row.aworkProjectKeyFieldId,
      projectNumberFieldId: row.aworkProjectNumberFieldId,
      aworkProjectNumberFieldId: row.aworkProjectNumberCustomFieldId,
      projectTypes: parseProjektTypen(row.aworkProjectTypes),
      taskListName: row.aworkTaskListName,
      taskTitlePrefix: row.aworkTaskTitlePrefix,
      fallbackUserId: row.aworkFallbackUserId,
      autoCreateProjects: row.aworkAutoCreateProjects,
      writeBackLink: row.aworkWriteBackLink,
      syncProjectNumber: row.aworkSyncProjectNumber,
      excludeTerms: row.aworkExcludeTerms,
      events: aworkEvents().map((info) => ({
        event: info.event,
        enabled: info.alwaysOn ? true : this.ereignisAn(row, info.event),
        alwaysOn: Boolean(info.alwaysOn),
        target: info.target,
      })),
      lastCheckAt: row.aworkLastCheckAt?.toISOString() ?? null,
      lastError: row.aworkLastError,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async update(input: UpdateAworkSettingsInput): Promise<AworkSettingsDto> {
    await this.settings.getRow();

    const ereignisse: Partial<Record<(typeof EREIGNIS_SPALTEN)[keyof typeof EREIGNIS_SPALTEN], boolean>> =
      {};
    for (const eintrag of input.events ?? []) {
      const spalte = EREIGNIS_SPALTEN[eintrag.event as keyof typeof EREIGNIS_SPALTEN];
      // `korrekturen` ist nicht abschaltbar und hat deshalb gar keine Spalte.
      if (spalte) ereignisse[spalte] = eintrag.enabled;
    }

    await this.db
      .update(appSettings)
      .set({
        aworkEnabled: input.enabled,
        aworkApiKeyEncrypted:
          input.apiKey === undefined
            ? undefined
            : input.apiKey
              ? encryptSecret(input.apiKey, this.config.jwt.secret)
              : null,
        aworkProjectKeyFieldId:
          input.projectKeyFieldId === undefined ? undefined : input.projectKeyFieldId,
        aworkProjectTypes:
          input.projectTypes === undefined
            ? undefined
            : input.projectTypes && input.projectTypes.length > 0
              ? input.projectTypes.join(',')
              : null,
        aworkProjectNumberFieldId:
          input.projectNumberFieldId === undefined ? undefined : input.projectNumberFieldId,
        aworkProjectNumberCustomFieldId:
          input.aworkProjectNumberFieldId === undefined
            ? undefined
            : input.aworkProjectNumberFieldId,
        aworkTaskListName:
          input.taskListName === undefined
            ? undefined
            : input.taskListName.trim().slice(0, MAX_AWORK_TASK_LIST_NAME) || 'Postproduktion',
        aworkTaskTitlePrefix:
          input.taskTitlePrefix === undefined
            ? undefined
            : input.taskTitlePrefix.slice(0, MAX_AWORK_TASK_TITLE_PREFIX),
        aworkFallbackUserId: input.fallbackUserId === undefined ? undefined : input.fallbackUserId,
        aworkAutoCreateProjects: input.autoCreateProjects,
        aworkWriteBackLink: input.writeBackLink,
        aworkSyncProjectNumber: input.syncProjectNumber,
        aworkExcludeTerms:
          input.excludeTerms === undefined
            ? undefined
            : input.excludeTerms?.trim().slice(0, MAX_AWORK_EXCLUDE_TERMS) || null,
        ...ereignisse,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));

    return this.get();
  }

  /**
   * Das Klappe-Feld für den awork-Projekt-Key – anlegen, falls es fehlt
   * (1.5.2).
   *
   * Wird beim Einschalten der Anbindung gerufen. Der Key ist die Kennung, über
   * die zugeordnet wird; ihn von Hand als Freifeld anlegen zu lassen, wäre ein
   * Einrichtungsschritt, den man vergisst und dessen Fehlen sich erst
   * bemerkbar macht, wenn nichts zusammenfindet.
   *
   * Das Feld bleibt aus der Projektliste heraus: nicht filterbar, nicht
   * sortierbar, nicht gruppierbar, nicht auf der Kachel. Es ist eine technische
   * Kennung – auf der Projektseite steht sie, in der Übersicht wäre sie nur
   * Rauschen.
   */
  async ensureProjektKeyFeld(): Promise<string> {
    const row = await this.settings.getRow();
    if (row.aworkProjectKeyFieldId) {
      // Gewählt, aber inzwischen gelöscht? Dann fällt es hier auf.
      const [vorhanden] = await this.db
        .select({ id: projectFieldDefs.id })
        .from(projectFieldDefs)
        .where(eq(projectFieldDefs.id, row.aworkProjectKeyFieldId))
        .limit(1);
      if (vorhanden) return vorhanden.id;
    }

    // Vielleicht gibt es das Feld schon unter diesem Namen – dann nehmen wir es,
    // statt ein zweites mit derselben Bedeutung danebenzustellen.
    const [bestehend] = await this.db
      .select({ id: projectFieldDefs.id })
      .from(projectFieldDefs)
      .where(sql`lower(${projectFieldDefs.name}) = ${AWORK_KEY_FELDNAME.toLowerCase()}`)
      .limit(1);

    let feldId = bestehend?.id;
    if (!feldId) {
      const [{ max }] = await this.db
        .select({ max: sql<number>`coalesce(max(${projectFieldDefs.sortOrder}), 0)` })
        .from(projectFieldDefs);
      const [angelegt] = await this.db
        .insert(projectFieldDefs)
        .values({
          name: AWORK_KEY_FELDNAME,
          sortOrder: max + 1,
          suggest: false,
          filterable: false,
          sortable: false,
          groupable: false,
          showOnTile: false,
        })
        .returning();
      feldId = angelegt.id;
    }

    await this.db
      .update(appSettings)
      .set({ aworkProjectKeyFieldId: feldId, updatedAt: new Date() })
      .where(eq(appSettings.id, SETTINGS_ID));
    return feldId;
  }

  /**
   * Der Schlüssel im Klartext – nur serverintern. `null` heißt: keiner
   * hinterlegt, oder `JWT_SECRET` wurde gewechselt und der gespeicherte Wert
   * lässt sich nicht mehr entschlüsseln.
   */
  async apiKey(): Promise<string | null> {
    const row = await this.settings.getRow();
    if (!row.aworkEnabled) return null;
    return decryptSecret(row.aworkApiKeyEncrypted, this.config.jwt.secret);
  }

  /**
   * Derselbe Schlüssel, aber ohne die Frage nach dem Schalter – für den
   * Verbindungstest. Wer die Anbindung einrichtet, will sie ausprobieren
   * dürfen, **bevor** er sie scharf schaltet.
   */
  async apiKeyForCheck(): Promise<string | null> {
    const row = await this.settings.getRow();
    return decryptSecret(row.aworkApiKeyEncrypted, this.config.jwt.secret);
  }

  /**
   * Läuft die Anbindung? Prüft beides – Schalter **und** Schlüssel: Ein
   * eingeschalteter Haken ohne Zugangsdaten würde bei jedem Kommentar einen
   * Auftrag erzeugen, der nur scheitern kann.
   */
  async isReady(): Promise<boolean> {
    const row = await this.settings.getRow();
    return row.aworkEnabled && Boolean(row.aworkApiKeyEncrypted);
  }

  /** Ist dieses Ereignis eingeschaltet? `korrekturen` immer. */
  async eventEnabled(event: AworkEvent): Promise<boolean> {
    const row = await this.settings.getRow();
    return this.ereignisAn(row, event);
  }

  private ereignisAn(row: AppSettingsRow, event: AworkEvent): boolean {
    const spalte = EREIGNIS_SPALTEN[event as keyof typeof EREIGNIS_SPALTEN];
    if (!spalte) return true;
    return Boolean(row[spalte]);
  }

  /** Der volle Satz Werte für den Sync – erspart dem Aufrufer sechs Abfragen. */
  async syncConfig(): Promise<{
    projectKeyFieldId: string | null;
    projectTypes: string[];
    projectNumberFieldId: string | null;
    aworkProjectNumberFieldId: string | null;
    taskListName: string;
    taskTitlePrefix: string;
    fallbackUserId: string | null;
    autoCreateProjects: boolean;
    writeBackLink: boolean;
    syncProjectNumber: boolean;
    excludeTerms: string | null;
    pollLastRunAt: Date | null;
  }> {
    const row = await this.settings.getRow();
    return {
      projectKeyFieldId: row.aworkProjectKeyFieldId,
      projectTypes: parseProjektTypen(row.aworkProjectTypes),
      projectNumberFieldId: row.aworkProjectNumberFieldId,
      aworkProjectNumberFieldId: row.aworkProjectNumberCustomFieldId,
      taskListName: row.aworkTaskListName,
      taskTitlePrefix: row.aworkTaskTitlePrefix,
      fallbackUserId: row.aworkFallbackUserId,
      autoCreateProjects: row.aworkAutoCreateProjects,
      writeBackLink: row.aworkWriteBackLink,
      syncProjectNumber: row.aworkSyncProjectNumber,
      excludeTerms: row.aworkExcludeTerms,
      pollLastRunAt: row.aworkPollLastRunAt,
    };
  }

  /**
   * Hält den Ausgang des letzten Zugriffs fest – der Betreiber sieht in den
   * Einstellungen, ob die Anbindung gerade trägt, ohne in die Logs zu steigen.
   */
  async merkeErgebnis(fehler: string | null): Promise<void> {
    await this.settings.getRow();
    await this.db
      .update(appSettings)
      .set({
        aworkLastCheckAt: new Date(),
        aworkLastError: fehler ? fehler.slice(0, 500) : null,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));
  }

  async merkePollLauf(zeitpunkt: Date): Promise<void> {
    await this.settings.getRow();
    await this.db
      .update(appSettings)
      .set({ aworkPollLastRunAt: zeitpunkt, updatedAt: new Date() })
      .where(eq(appSettings.id, SETTINGS_ID));
  }
}
