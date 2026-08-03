/**
 * Die Anbindung an awork (Phase 30).
 *
 * awork ist das Projektmanagement, in dem die Filmprojekte ohnehin liegen.
 * Klappe schreibt dorthin – Korrekturen werden zu Aufgaben, Meldungen ohne
 * Aufgabencharakter zu Projekt-Kommentaren – und holt in der Gegenrichtung
 * neu angelegte Projekte ab.
 *
 * Wie beim Benachrichtigungs-Katalog steht die Liste der Ereignisse **im
 * geteilten Paket**: Die API prüft damit vor dem Schreiben, die
 * Einstellungsseite zeigt dieselben Schalter, und eine neue Art ist genau ein
 * Eintrag hier.
 */

/**
 * Was Klappe nach awork meldet.
 *
 * - `korrekturen` – die Kommentare einer Fassung als Aufgabe. Nicht
 *   abschaltbar: Das ist der Zweck der Anbindung; wer sie nicht will, lässt
 *   die Anbindung aus.
 * - `kundenmaterial` – der Kunde hat Dateien hochgeladen.
 * - `erstbesuch` – der Kunde hat die Freigabe zum ersten Mal geöffnet.
 * - `fassung-verfuegbar` – eine Fassung ist beim Kunden angekommen, also
 *   fertig verarbeitet **und** nicht mehr intern. Deckt „neu hochgeladen" und
 *   „nachträglich freigegeben" in einem ab: Gemeint ist der Moment, in dem der
 *   Kunde den Link tatsächlich hat.
 * - `endfassung` – eine Fassung wurde als Endfassung markiert. Schließt
 *   bewusst keine Aufgaben; das Häkchen sagt etwas über den Film, nicht über
 *   den Stand der Korrekturen.
 * - `aufgabe-erledigen` – sind alle Kommentare einer Fassung erledigt, wird
 *   die Aufgabe in awork geschlossen.
 */
export const AWORK_EVENTS = [
  'korrekturen',
  'kundenmaterial',
  'erstbesuch',
  'fassung-verfuegbar',
  'endfassung',
  'aufgabe-erledigen',
] as const;
export type AworkEvent = (typeof AWORK_EVENTS)[number];

export interface AworkEventInfo {
  event: AworkEvent;
  /** Ab Werk an? Entschieden am 03.08.2026, siehe Kopfkommentar. */
  defaultOn: boolean;
  /** Nicht abschaltbar – gilt, sobald die Anbindung läuft. */
  alwaysOn?: boolean;
  /** Als Aufgabe oder als Projekt-Kommentar in awork? Nur zur Anzeige. */
  target: 'aufgabe' | 'projektkommentar';
}

const AWORK_EVENT_INFOS: readonly AworkEventInfo[] = [
  { event: 'korrekturen', defaultOn: true, alwaysOn: true, target: 'aufgabe' },
  { event: 'kundenmaterial', defaultOn: true, target: 'projektkommentar' },
  { event: 'erstbesuch', defaultOn: true, target: 'projektkommentar' },
  { event: 'fassung-verfuegbar', defaultOn: false, target: 'projektkommentar' },
  { event: 'endfassung', defaultOn: false, target: 'projektkommentar' },
  { event: 'aufgabe-erledigen', defaultOn: false, target: 'aufgabe' },
];

/** Die Ereignisse in der Reihenfolge, in der sie in den Einstellungen stehen. */
export function aworkEvents(): AworkEventInfo[] {
  return [...AWORK_EVENT_INFOS];
}

/** Ein Schalter, wie ihn die API liefert und die Oberfläche zurückschreibt. */
export interface AworkEventSettingDto {
  event: AworkEvent;
  enabled: boolean;
  alwaysOn: boolean;
  target: 'aufgabe' | 'projektkommentar';
}

/**
 * Wie eine Zuordnung zwischen Klappe- und awork-Projekt zustande kam.
 *
 * `nummer` ist der Normalfall – beide Seiten tragen dieselbe Projektnummer.
 * `manuell` hat jemand in den Projekteinstellungen ausgewählt, `angelegt`
 * entsteht, wenn Klappe das Projekt selbst aus awork übernommen hat.
 */
export const AWORK_MATCH_SOURCES = ['nummer', 'manuell', 'angelegt'] as const;
export type AworkMatchSource = (typeof AWORK_MATCH_SOURCES)[number];

export interface AworkSettingsDto {
  /** Läuft die Anbindung? Ab Werk aus. */
  enabled: boolean;
  /** Der API-Schlüssel steht nie im Klartext in einer Antwort. */
  hasApiKey: boolean;
  /**
   * Welches Klappe-Projektfeld die Projektnummer trägt. Ohne diese Angabe
   * findet die Zuordnung nichts – deshalb der erste Schritt in den
   * Einstellungen.
   */
  projectNumberFieldId: string | null;
  /** Das Gegenstück: die Freifeld-Definition in awork. */
  aworkProjectNumberFieldId: string | null;
  /** Aufgabenliste, in die die Korrektur-Aufgaben einsortiert werden. */
  taskListName: string;
  /** Steht vor dem Videonamen im Aufgabentitel. */
  taskTitlePrefix: string;
  /**
   * Wer eingetragen wird, wenn ein aus awork übernommenes Projekt keinen
   * passenden Klappe-Nutzer als Anleger hat.
   */
  fallbackUserId: string | null;
  /** Neue awork-Projekte automatisch in Klappe anlegen (Gegenrichtung). */
  autoCreateProjects: boolean;
  /** Den Klappe-Link als Projekt-Kommentar nach awork schreiben. */
  writeBackLink: boolean;
  /** Fehlende Projektnummern zwischen beiden Seiten angleichen. */
  syncProjectNumber: boolean;
  events: AworkEventSettingDto[];
  /** Ergebnis des letzten Verbindungsversuchs – für die Anzeige. */
  lastCheckAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

/** Antwort des Verbindungstests in den Einstellungen. */
export interface AworkCheckDto {
  ok: boolean;
  /** Klartext, direkt anzeigbar. */
  message: string;
  /** Wie viele Nutzer und Projekte gefunden wurden – der Beweis, dass es geht. */
  userCount: number | null;
  projectCount: number | null;
}

/** Eine Freifeld-Definition aus awork, für die Auswahl in den Einstellungen. */
export interface AworkFieldDto {
  id: string;
  name: string;
  type: string;
}

/** Ein awork-Projekt, für die manuelle Zuordnung im Klappe-Projekt. */
export interface AworkProjectDto {
  id: string;
  name: string;
  company: string | null;
  projectNumber: string | null;
}

/** Die Zuordnung eines einzelnen Klappe-Projekts. */
export interface AworkProjectLinkDto {
  projectId: string;
  aworkProjectId: string;
  aworkProjectName: string | null;
  matchedBy: AworkMatchSource;
  linkedAt: string;
}

/**
 * Was die Projektseite über die Anbindung wissen muss: die Zuordnung selbst
 * und, falls es keine gibt, warum nicht.
 */
export interface AworkProjectStateDto {
  /** Läuft die Anbindung überhaupt? Sonst zeigt die Oberfläche nichts an. */
  enabled: boolean;
  link: AworkProjectLinkDto | null;
  /**
   * Die Projektnummer dieses Projekts – der Schlüssel, über den gesucht wird.
   * `null` heißt: Feld leer oder gar nicht eingerichtet.
   */
  projectNumber: string | null;
  /** Aufgaben, die Klappe für dieses Projekt angelegt hat. */
  taskCount: number;
}

export const MAX_AWORK_TASK_TITLE_PREFIX = 60;
export const MAX_AWORK_TASK_LIST_NAME = 120;

/** Die eine Adresse der awork-API. Steht hier, damit sie nur einmal existiert. */
export const AWORK_API_BASE_URL = 'https://api.awork.com/api/v1';
