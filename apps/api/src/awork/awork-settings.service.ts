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
  MAX_AWORK_TASK_LIST_NAME,
  MAX_AWORK_TASK_TITLE_PREFIX,
  aworkEvents,
} from '@klappe/shared';
import { eq } from 'drizzle-orm';
import { decryptSecret, encryptSecret } from '../common/secret-box';
import { AppConfig, CONFIG } from '../config/configuration';
import { DB, type Database } from '../db/db.module';
import { type AppSettingsRow, appSettings } from '../db/schema';
import { SETTINGS_ID, SettingsService } from '../settings/settings.service';

export interface UpdateAworkSettingsInput {
  enabled?: boolean;
  /** `undefined` = unverändert, `null` = löschen, sonst neuer Schlüssel. */
  apiKey?: string | null;
  projectNumberFieldId?: string | null;
  aworkProjectNumberFieldId?: string | null;
  taskListName?: string;
  taskTitlePrefix?: string;
  fallbackUserId?: string | null;
  autoCreateProjects?: boolean;
  writeBackLink?: boolean;
  syncProjectNumber?: boolean;
  events?: Array<{ event: AworkEvent; enabled: boolean }>;
}

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
      projectNumberFieldId: row.aworkProjectNumberFieldId,
      aworkProjectNumberFieldId: row.aworkProjectNumberCustomFieldId,
      taskListName: row.aworkTaskListName,
      taskTitlePrefix: row.aworkTaskTitlePrefix,
      fallbackUserId: row.aworkFallbackUserId,
      autoCreateProjects: row.aworkAutoCreateProjects,
      writeBackLink: row.aworkWriteBackLink,
      syncProjectNumber: row.aworkSyncProjectNumber,
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
        ...ereignisse,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, SETTINGS_ID));

    return this.get();
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
    projectNumberFieldId: string | null;
    aworkProjectNumberFieldId: string | null;
    taskListName: string;
    taskTitlePrefix: string;
    fallbackUserId: string | null;
    autoCreateProjects: boolean;
    writeBackLink: boolean;
    syncProjectNumber: boolean;
    pollLastRunAt: Date | null;
  }> {
    const row = await this.settings.getRow();
    return {
      projectNumberFieldId: row.aworkProjectNumberFieldId,
      aworkProjectNumberFieldId: row.aworkProjectNumberCustomFieldId,
      taskListName: row.aworkTaskListName,
      taskTitlePrefix: row.aworkTaskTitlePrefix,
      fallbackUserId: row.aworkFallbackUserId,
      autoCreateProjects: row.aworkAutoCreateProjects,
      writeBackLink: row.aworkWriteBackLink,
      syncProjectNumber: row.aworkSyncProjectNumber,
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
