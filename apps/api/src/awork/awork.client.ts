/**
 * Der Draht zur awork-API (Phase 30).
 *
 * Bewusst dünn: Nur die Aufrufe, die die Anbindung wirklich braucht, jeweils
 * mit dem Ausschnitt der Antwort, den Klappe liest. awork liefert an jedem
 * Projekt und jeder Aufgabe drei Dutzend Felder – die vollständig abzubilden
 * hieße, sie bei jeder Änderung dort nachzuziehen.
 *
 * Zwei Eigenheiten der API prägen alles hier:
 *
 * 1. **`PUT` ersetzt das ganze Objekt.** Fehlende Felder werden geleert. Wer
 *    eine Aufgabenbeschreibung ändern will, liest die Aufgabe, ändert das eine
 *    Feld und schreibt alles zurück – siehe `updateTask`.
 * 2. **Der API-Schlüssel hat Administratorrechte.** Es gibt keine Abstufung;
 *    deshalb gehört in awork ein eigener API-Benutzer davor.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AWORK_API_BASE_URL } from '@klappe/shared';
import { AworkSettingsService } from './awork-settings.service';

/** Nach dieser Zeit gilt eine einzelne Anfrage als gescheitert. */
const HTTP_TIMEOUT_MS = 20_000;
/** Wie oft eine Anfrage wiederholt wird, bevor der Auftrag scheitert. */
const MAX_ATTEMPTS = 3;
/** Grundabstand fürs Wiederholen; verdoppelt sich je Versuch. */
const RETRY_BASE_MS = 1_000;
/** Seitengröße beim Abholen von Listen. */
const PAGE_SIZE = 200;
/** Notbremse: So viele Seiten holt eine Liste höchstens. */
const MAX_PAGES = 50;

/**
 * Ein Fehler von awork, mit dem Klartext für den Betreiber. `status` ist der
 * HTTP-Code; `null` heißt „gar nicht erst hingekommen" (Netz, Zeitablauf).
 */
export class AworkError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** Bei `true` lohnt ein späterer Versuch – Netz, 429, 5xx. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AworkError';
  }
}

/** Nicht eingerichtet: kein Schlüssel hinterlegt oder Anbindung aus. */
export class AworkNotConfiguredError extends AworkError {
  constructor() {
    super('Die awork-Anbindung ist nicht eingerichtet.', null, false);
    this.name = 'AworkNotConfiguredError';
  }
}

export interface AworkUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  isDeactivated: boolean;
  /** Aus `userContactInfos` herausgezogen, kleingeschrieben. */
  email: string | null;
}

export interface AworkCustomFieldValue {
  customFieldDefinitionId: string;
  textValue?: string | null;
}

export interface AworkCustomFieldDefinition {
  id: string;
  name: string;
  type: string;
  entity: string;
}

export interface AworkProject {
  id: string;
  name: string;
  companyName: string | null;
  createdBy: string | null;
  createdOn: string | null;
  updatedOn: string | null;
  customFields: AworkCustomFieldValue[];
  isArchived: boolean;
}

export interface AworkTaskStatus {
  id: string;
  name: string | null;
  /** `todo`, `progress`, `review`, `stuck` oder `done`. */
  type: string | null;
}

export interface AworkTaskList {
  id: string;
  name: string | null;
}

/**
 * Eine Aufgabe, so wie Klappe sie liest. `raw` trägt das vollständige Objekt
 * mit – nötig fürs Zurückschreiben, siehe `updateTask`.
 */
export interface AworkTask {
  id: string;
  name: string;
  description: string | null;
  taskStatusId: string | null;
  closedOn: string | null;
  assigneeIds: string[];
  raw: Record<string, unknown>;
}

@Injectable()
export class AworkClient {
  private readonly logger = new Logger(AworkClient.name);

  constructor(
    @Inject(AworkSettingsService) private readonly settings: AworkSettingsService,
  ) {}

  // ---------------------------------------------------------------- Anfragen

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    options: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    const apiKey = await this.settings.apiKey();
    if (!apiKey) throw new AworkNotConfiguredError();
    return this.requestWithKey<T>(method, path, apiKey, options);
  }

  /**
   * Dieselbe Anfrage mit ausdrücklich übergebenem Schlüssel – für den
   * Verbindungstest in den Einstellungen, der einen noch nicht gespeicherten
   * Schlüssel prüfen können muss.
   */
  private async requestWithKey<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    apiKey: string,
    options: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    const url = new URL(`${AWORK_API_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let letzterFehler: AworkError | null = null;

    for (let versuch = 1; versuch <= MAX_ATTEMPTS; versuch += 1) {
      try {
        const response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        });

        if (response.ok) {
          // 204 und leere Antworten kommen bei `delete` und einigen `post`.
          if (response.status === 204) return undefined as T;
          const text = await response.text();
          return (text ? JSON.parse(text) : undefined) as T;
        }

        const fehler = await this.fehlerAus(response);
        if (!fehler.retryable) throw fehler;
        letzterFehler = fehler;

        /*
         * Bei 429 sagt awork selbst, wie lange zu warten ist. Den Wert zu
         * nehmen ist nicht nur höflich – ein eigener Rhythmus liefe sonst
         * genau in die nächste Sperre.
         */
        const wartezeit =
          response.status === 429
            ? this.resetAus(response) ?? RETRY_BASE_MS * versuch
            : RETRY_BASE_MS * 2 ** (versuch - 1);
        if (versuch < MAX_ATTEMPTS) await warte(wartezeit);
      } catch (error) {
        if (error instanceof AworkError) {
          if (!error.retryable) throw error;
          letzterFehler = error;
        } else {
          // Netz, DNS, Zeitablauf – alles Gründe, es gleich noch mal zu versuchen.
          letzterFehler = new AworkError(
            `awork ist nicht erreichbar: ${beschreibe(error)}`,
            null,
            true,
          );
        }
        if (versuch < MAX_ATTEMPTS) await warte(RETRY_BASE_MS * 2 ** (versuch - 1));
      }
    }

    throw letzterFehler ?? new AworkError('awork antwortet nicht.', null, true);
  }

  private async fehlerAus(response: Response): Promise<AworkError> {
    let text = '';
    try {
      text = await response.text();
    } catch {
      // Antwort ohne lesbaren Rumpf – der Statuscode allein muss reichen.
    }

    let beschreibung = text.slice(0, 500);
    try {
      const payload = JSON.parse(text) as { description?: string; code?: string };
      if (payload?.description) beschreibung = payload.description;
    } catch {
      // Kein JSON: der Rohtext ist immer noch besser als nichts.
    }

    const meldung =
      response.status === 401 || response.status === 403
        ? 'awork weist den Schlüssel ab – bitte den API-Schlüssel prüfen.'
        : response.status === 404
          ? `In awork nicht gefunden: ${beschreibung || response.url}`
          : `awork meldet Fehler ${response.status}${beschreibung ? `: ${beschreibung}` : ''}`;

    // 429 und 5xx gehen vorbei, alles andere ist ein Fehler auf unserer Seite.
    const retryable = response.status === 429 || response.status >= 500;
    return new AworkError(meldung, response.status, retryable);
  }

  /** Wartezeit aus dem `ratelimit-reset`-Header, in Millisekunden. */
  private resetAus(response: Response): number | null {
    const sekunden = Number(response.headers.get('ratelimit-reset'));
    if (!Number.isFinite(sekunden) || sekunden < 0) return null;
    // Eine Sekunde Zuschlag: genau auf der Kante wieder anzuklopfen scheitert.
    return Math.min(sekunden + 1, 60) * 1000;
  }

  /** Holt alle Seiten einer Liste ein. */
  private async listAll<T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
  ): Promise<T[]> {
    const alle: T[] = [];
    for (let seite = 1; seite <= MAX_PAGES; seite += 1) {
      const teil = await this.request<T[]>('GET', path, {
        query: { ...query, page: seite, pageSize: PAGE_SIZE },
      });
      if (!Array.isArray(teil) || teil.length === 0) break;
      alle.push(...teil);
      if (teil.length < PAGE_SIZE) break;
      if (seite === MAX_PAGES) {
        this.logger.warn(`${path}: bei ${MAX_PAGES} Seiten abgebrochen – Liste womöglich unvollständig.`);
      }
    }
    return alle;
  }

  // ------------------------------------------------------------ Verbindungstest

  /**
   * Prüft einen Schlüssel, ohne ihn zu speichern. Liefert Nutzer- und
   * Projektzahl zurück – der Beweis, dass die Verbindung wirklich steht und
   * nicht nur ein Endpunkt „OK" sagt.
   */
  async check(apiKey: string): Promise<{ userCount: number; projectCount: number }> {
    const nutzer = await this.requestWithKey<unknown[]>('GET', '/users', apiKey, {
      query: { page: 1, pageSize: PAGE_SIZE },
    });
    const projekte = await this.requestWithKey<unknown[]>('GET', '/projects', apiKey, {
      query: { page: 1, pageSize: PAGE_SIZE },
    });
    return {
      userCount: Array.isArray(nutzer) ? nutzer.length : 0,
      projectCount: Array.isArray(projekte) ? projekte.length : 0,
    };
  }

  // -------------------------------------------------------------------- Nutzer

  /**
   * Alle Nutzer samt Mailadresse. awork liefert die Adressen in
   * `userContactInfos` mit – ein zweiter Aufruf je Person wäre bei zehn Leuten
   * verschmerzbar, bei hundert nicht.
   */
  async listUsers(): Promise<AworkUser[]> {
    const rows = await this.listAll<{
      id: string;
      firstName?: string | null;
      lastName?: string | null;
      isDeactivated?: boolean;
      userContactInfos?: { type?: string | null; value?: string | null }[] | null;
    }>('/users');

    return rows.map((row) => ({
      id: row.id,
      firstName: row.firstName ?? null,
      lastName: row.lastName ?? null,
      isDeactivated: Boolean(row.isDeactivated),
      email:
        (row.userContactInfos ?? [])
          .find((info) => info?.type === 'email' && info.value)
          ?.value?.trim()
          .toLowerCase() ?? null,
    }));
  }

  // ----------------------------------------------------------------- Freifelder

  async listCustomFieldDefinitions(): Promise<AworkCustomFieldDefinition[]> {
    const rows = await this.request<
      { id: string; name?: string | null; type?: string | null; entity?: string | null }[]
    >('GET', '/customfielddefinitions');
    return (rows ?? []).map((row) => ({
      id: row.id,
      name: row.name ?? '',
      type: row.type ?? 'text',
      entity: row.entity ?? 'project',
    }));
  }

  // -------------------------------------------------------------------- Projekte

  async listProjects(): Promise<AworkProject[]> {
    const rows = await this.listAll<Record<string, unknown>>('/projects', {
      orderby: 'updatedOn desc',
    });
    return rows.map((row) => toProject(row));
  }

  async getProject(aworkProjectId: string): Promise<AworkProject | null> {
    try {
      const row = await this.request<Record<string, unknown>>('GET', `/projects/${aworkProjectId}`);
      return row ? toProject(row) : null;
    } catch (error) {
      if (error instanceof AworkError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * Einen Freifeld-Wert am Projekt setzen. Der Rumpf ist ein **nacktes
   * Array** – kein `{ customFields: [...] }`; das quittiert awork mit einem
   * Validierungsfehler.
   */
  async setProjectCustomField(
    aworkProjectId: string,
    customFieldDefinitionId: string,
    value: string,
  ): Promise<void> {
    await this.request('POST', `/projects/${aworkProjectId}/setcustomfields`, {
      body: [{ customFieldDefinitionId, textValue: value }],
    });
  }

  async createProjectComment(aworkProjectId: string, message: string): Promise<void> {
    await this.request('POST', `/projects/${aworkProjectId}/comments`, { body: { message } });
  }

  // -------------------------------------------------------------------- Aufgaben

  async listTaskStatuses(aworkProjectId: string): Promise<AworkTaskStatus[]> {
    const rows = await this.request<
      { id: string; name?: string | null; type?: string | null }[]
    >('GET', `/projects/${aworkProjectId}/taskstatuses`);
    return (rows ?? []).map((row) => ({ id: row.id, name: row.name ?? null, type: row.type ?? null }));
  }

  async listTaskLists(aworkProjectId: string): Promise<AworkTaskList[]> {
    const rows = await this.request<{ id: string; name?: string | null; isArchived?: boolean }[]>(
      'GET',
      `/projects/${aworkProjectId}/tasklists`,
    );
    return (rows ?? [])
      .filter((row) => !row.isArchived)
      .map((row) => ({ id: row.id, name: row.name ?? null }));
  }

  /**
   * Legt eine Aufgabenliste an. Nötig, wenn ein Projekt die eingestellte
   * Liste nicht hat – die Aufgabe soll dann trotzdem entstehen und nicht am
   * fehlenden Fach scheitern.
   */
  async createTaskList(aworkProjectId: string, name: string): Promise<AworkTaskList> {
    const row = await this.request<{ id: string; name?: string | null }>(
      'POST',
      `/projects/${aworkProjectId}/tasklists`,
      { body: { name } },
    );
    return { id: row.id, name: row.name ?? name };
  }

  /**
   * Legt eine Aufgabe im Projekt an.
   *
   * `entityId` plus `baseType` – **nicht** `projectId`; das Feld gibt es an
   * dieser Stelle nicht. Steht `lists` im Rumpf, muss jedes `order` eine Zahl
   * sein, sonst weist awork den ganzen Aufruf ab.
   */
  async createTask(input: {
    aworkProjectId: string;
    name: string;
    description: string;
    taskStatusId: string;
    taskListId?: string | null;
  }): Promise<AworkTask> {
    const row = await this.request<Record<string, unknown>>('POST', '/tasks', {
      body: {
        name: input.name,
        baseType: 'projecttask',
        entityId: input.aworkProjectId,
        taskStatusId: input.taskStatusId,
        description: input.description,
        ...(input.taskListId ? { lists: [{ id: input.taskListId, order: 0 }] } : {}),
      },
    });
    return toTask(row);
  }

  async getTask(aworkTaskId: string): Promise<AworkTask | null> {
    try {
      const row = await this.request<Record<string, unknown>>('GET', `/tasks/${aworkTaskId}`);
      return row ? toTask(row) : null;
    } catch (error) {
      if (error instanceof AworkError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * Ändert die Beschreibung einer Aufgabe.
   *
   * awork kennt kein Teil-Update: Der `PUT` ersetzt das gesamte Objekt, und
   * was im Rumpf fehlt, ist danach leer. Deshalb wird die Aufgabe frisch
   * gelesen und vollständig zurückgeschrieben – deshalb auch `raw`.
   */
  async updateTaskDescription(task: AworkTask, description: string): Promise<void> {
    await this.request('PUT', `/tasks/${task.id}`, {
      body: { ...task.raw, description },
    });
  }

  /**
   * Setzt die Bearbeiter. Der Rumpf ist ein nacktes Array von Nutzer-IDs, und
   * der Aufruf **ersetzt** die bestehende Liste – wer sie erweitern will,
   * schickt die alten Kennungen mit.
   */
  async setAssignees(aworkTaskId: string, aworkUserIds: string[]): Promise<void> {
    await this.request('POST', `/tasks/${aworkTaskId}/setassignees`, { body: aworkUserIds });
  }

  async changeTaskStatus(aworkTaskId: string, statusId: string): Promise<void> {
    await this.request('POST', '/tasks/changestatuses', {
      body: [{ taskId: aworkTaskId, statusId, order: null }],
    });
  }

  async createTaskComment(aworkTaskId: string, message: string): Promise<void> {
    await this.request('POST', `/tasks/${aworkTaskId}/comments`, { body: { message } });
  }
}

function toProject(row: Record<string, unknown>): AworkProject {
  const company = row.company as { name?: string | null } | null | undefined;
  const felder = (row.customFields as AworkCustomFieldValue[] | null) ?? [];
  const status = row.projectStatus as { isArchived?: boolean } | null | undefined;
  return {
    id: String(row.id),
    name: typeof row.name === 'string' ? row.name : '',
    companyName: company?.name ?? null,
    createdBy: typeof row.createdBy === 'string' ? row.createdBy : null,
    createdOn: typeof row.createdOn === 'string' ? row.createdOn : null,
    updatedOn: typeof row.updatedOn === 'string' ? row.updatedOn : null,
    customFields: Array.isArray(felder) ? felder : [],
    isArchived: Boolean(status?.isArchived),
  };
}

function toTask(row: Record<string, unknown>): AworkTask {
  const assignees = (row.assignees as { id?: string }[] | null) ?? [];
  return {
    id: String(row.id),
    name: typeof row.name === 'string' ? row.name : '',
    description: typeof row.description === 'string' ? row.description : null,
    taskStatusId: typeof row.taskStatusId === 'string' ? row.taskStatusId : null,
    closedOn: typeof row.closedOn === 'string' ? row.closedOn : null,
    assigneeIds: (Array.isArray(assignees) ? assignees : [])
      .map((eintrag) => eintrag?.id)
      .filter((id): id is string => Boolean(id)),
    raw: row,
  };
}

function warte(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function beschreibe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
