/**
 * Gemeinsame Typen der HTTP-Schnittstelle. API und Web-App benutzen exakt
 * diese Formen – damit bricht ein Feldwechsel im Backend sofort den Typecheck
 * im Frontend.
 */
import type { Annotation } from './annotations';
import type { FrameRate } from './timecode';

export const USER_ROLES = ['ADMIN', 'MEMBER', 'GUEST'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const VERSION_STATUSES = ['UPLOADING', 'PROCESSING', 'READY', 'FAILED'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const PLAYBACK_MODES = ['ORIGINAL', 'REMUX', 'TRANSCODE'] as const;
/** Wie die Abspielfassung entstanden ist. */
export type PlaybackMode = (typeof PLAYBACK_MODES)[number];

export const UPLOAD_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'ABORTED'] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  notificationsEnabled: boolean;
  createdAt: string;
}

export interface ProjectDto {
  id: string;
  name: string;
  /** Kunde hinter dem Projekt; geht in die Download-Dateinamen ein. */
  customer: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: UserSummaryDto | null;
  /**
   * Archiviert seit (Phase 18)? Dann bleibt das Projekt betrachtbar, zeigt
   * aber nur noch die neueste Fassung je Video, und kommentieren geht nicht
   * mehr. Ältere Fassungen verschwinden nach der eingestellten Frist.
   */
  archivedAt: string | null;
  videoCount: number;
  /** Anzahl Dateien im Kunden-Upload-Ordner. */
  fileCount: number;
  /** Darf der anfragende Benutzer hier Material hochladen? */
  canUploadFiles: boolean;
  /** Schlagworte des Projekts (Phase 12). */
  tags: TagRefDto[];
  /** Belegte benutzerdefinierte Felder (Phase 15) – leere fehlen. */
  fields: ProjectFieldValueDto[];
}

/** Definition eines benutzerdefinierten Projekt-Felds (Phase 15). */
export interface ProjectFieldDefDto {
  id: string;
  name: string;
  sortOrder: number;
  /** Tippvorschläge aus den Werten der anderen Projekte (Phase 16)? */
  suggest: boolean;
  /** An wie vielen Projekten das Feld belegt ist – für die Löschwarnung. */
  projectCount: number;
}

/** Ein Wert einer Filter-Dimension samt Projektzahl (Phase 16). */
export interface FieldValueCountDto {
  value: string;
  projectCount: number;
}

/** Einstellungen rund um Felder und Schlagworte (Phase 16). */
export interface ProjectFieldSettingsDto {
  tagsEnabled: boolean;
}

/** Ein belegtes Feld am Projekt. */
export interface ProjectFieldValueDto {
  fieldId: string;
  name: string;
  value: string;
}

/** Schlagwort, wie es am Projekt hängt – ohne Zählwerk. */
export interface TagRefDto {
  id: string;
  name: string;
  color: string;
}

/**
 * Kunde, wie ihn die Projektliste kennt (Phase 15). Keine eigene Entität,
 * sondern die verdichteten Textwerte aus den Projekten.
 */
export interface CustomerDto {
  name: string;
  projectCount: number;
}

export interface UserSummaryDto {
  id: string;
  name: string;
  email: string;
  /**
   * Seit Phase 20 dabei, damit die Oberfläche das Firmenkürzel nur hinter
   * Namen des eigenen Teams setzt. Dass ein Gast dadurch sieht, wer Team ist
   * und wer nicht, ist genau der Zweck.
   */
  role: UserRole;
}

/** Schlagwort für Projekte (Phase 12). */
export interface TagDto {
  id: string;
  name: string;
  color: string;
  /** Wie viele Projekte dieses Schlagwort tragen. */
  projectCount: number;
  createdAt: string;
}

export interface VideoDto {
  id: string;
  projectId: string;
  /** Für die Brotkrumen, damit dort der Projektname steht und nicht „Projekt". */
  projectName: string | null;
  projectCustomer: string | null;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: UserSummaryDto | null;
  versionCount: number;
  latestVersion: VersionDto | null;
  /** Schalter am Video; der tatsächliche Download hängt zusätzlich am Link. */
  downloadsEnabled: boolean;
  /** Darf der anfragende Benutzer hier kommentieren und zeichnen? */
  canComment: boolean;
}

/** Auflösung und Framerate des Originals, aus `ffprobe`. */
export interface VersionMediaDto {
  durationSeconds: number | null;
  frameCount: number | null;
  frameRate: FrameRate | null;
  dropFrame: boolean;
  startTimecode: string | null;
  startTimecodeFrames: number;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrateBps: number | null;
}

export interface VersionSpriteDto {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  tileCount: number;
  intervalSeconds: number;
}

export interface VersionDto {
  id: string;
  videoId: string;
  versionNumber: number;
  label: string | null;
  status: VersionStatus;
  progress: number;
  processingError: string | null;
  originalFilename: string;
  originalSizeBytes: number;
  uploadedBy: UserSummaryDto | null;
  createdAt: string;
  media: VersionMediaDto;
  hasProxy: boolean;
  hasPoster: boolean;
  sprite: VersionSpriteDto | null;
  commentCount: number;
  /** Schalter für diese Fassung. */
  downloadEnabled: boolean;
  /** Endfassung (Phase 17)? Ohne Haken warnt die Oberfläche Gäste. */
  isFinal: boolean;
  /** Darf der anfragende Benutzer diese Fassung herunterladen? */
  canDownload: boolean;
  /** Wie die Abspielfassung entstanden ist – `null`, solange sie fehlt. */
  playbackMode: PlaybackMode | null;
  playbackReason: string | null;
  /** Datum der Fassung im Dateinamen (`JJMMTT`), beim Upload änderbar. */
  fileDate: string | null;
  /** Name, unter dem das Original heruntergeladen wird. */
  downloadFilename: string;
  /**
   * Stufen der adaptiven Wiedergabe, falls eine Leiter erzeugt wurde
   * (Phase 13) – etwa `['2160p','1080p','720p']`. Leer heißt: nur der
   * progressive Proxy.
   */
  hlsVariants: string[];
}

export interface CommentDto {
  id: string;
  versionId: string;
  parentId: string | null;
  author: UserSummaryDto;
  body: string;
  /** Frame-Index im Video; `null` = allgemeiner Kommentar ohne Zeitbezug. */
  frame: number | null;
  timecode: string | null;
  /** Zeichnung auf dem Bild dieses Frames, Koordinaten normalisiert auf 0…1. */
  annotation: Annotation | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  mentions: UserSummaryDto[];
  replies: CommentDto[];
}

export const UPLOAD_KINDS = ['VERSION', 'PROJECT_FILE'] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

export interface UploadSessionDto {
  id: string;
  kind: UploadKind;
  /** Bei `VERSION` gesetzt. */
  videoId: string | null;
  versionId: string | null;
  /** Bei `PROJECT_FILE` gesetzt. */
  projectId: string | null;
  filename: string;
  sizeBytes: number;
  offsetBytes: number;
  status: UploadStatus;
  /**
   * Verarbeitung im Zwischenspeicher (Phase 18). Sie beginnt, sobald die
   * Datei vollständig übertragen ist – auch wenn noch kein Ziel feststeht.
   * `NONE` heißt: noch nicht angefangen.
   */
  transcodeStatus: 'NONE' | 'PROCESSING' | 'READY' | 'FAILED';
  transcodeProgress: number;
  transcodeError: string | null;
  /** Absoluter Pfad für `PATCH`/`HEAD` nach tus-Semantik. */
  location: string;
  createdAt: string;
  expiresAt: string;
}

export const SHARE_SCOPES = ['PROJECT', 'VIDEO'] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];

export interface ShareLinkDto {
  id: string;
  token: string;
  scope: ShareScope;
  projectId: string | null;
  videoId: string | null;
  /** Name des freigegebenen Projekts bzw. Videos, für die Übersicht. */
  targetName: string;
  label: string | null;
  allowDownload: boolean;
  allowUpload: boolean;
  allowComments: boolean;
  /** Einbetten auf fremden Seiten – ohne Anmeldung, ohne Code, ohne Cookie. */
  embedEnabled: boolean;
  /**
   * Direktfreigabe (Phase 18): entstanden, weil ein vorhandener Gast mit einem
   * Klick erweitert wurde. Die Adresse verschickt niemand – die Oberfläche
   * blendet sie deshalb aus.
   */
  isDirect: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  isActive: boolean;
  /** Vollständige Adresse zum Weitergeben. */
  url: string;
  /** Adresse für das `src` eines `iframe`; `null`, solange Einbetten aus ist. */
  embedUrl: string | null;
  createdAt: string;
  createdBy: UserSummaryDto | null;
  guestCount: number;
}

/** Gast an einer Freigabe – Grundlage der Gästeübersicht. */
export interface ShareGuestDto {
  user: UserSummaryDto;
  shareLinkId: string;
  shareLabel: string | null;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

/** Ein Zugang eines Gastes, aufgeschlüsselt nach dem Link, über den er kommt. */
export interface GuestAccessLinkDto {
  shareLinkId: string;
  label: string | null;
  scope: ShareScope;
  /**
   * Name des Ziels. In der Projektansicht steht dahinter, dass jemand nur
   * *dieses eine* Video sieht – sonst sähe die Zeile aus wie ein voller
   * Projektzugang (Phase 18).
   */
  targetName: string;
  /**
   * Kennung des Ziels – bei `scope: 'VIDEO'` das Video, sonst das Projekt.
   * Damit lässt sich am Projekt ausrechnen, welche Videos einem Gast noch
   * fehlen (Phase 18); über den Namen zu gehen wäre bei Doppelungen falsch.
   */
  targetId: string;
  /** Über eine Direktfreigabe hereingekommen, nicht über einen Link. */
  isDirect: boolean;
  allowComments: boolean;
  allowDownload: boolean;
  allowUpload: boolean;
  /**
   * Für diese Person weichen die Rechte vom Link ab (Phase 16) – die
   * Oberfläche weist darauf hin, sonst wundert man sich über den Unterschied
   * zur Link-Einstellung.
   */
  hasOverride: boolean;
  /** Der Link selbst gilt noch (nicht zurückgezogen, nicht abgelaufen). */
  linkActive: boolean;
  /** Gesetzt, wenn diesem Gast der Zugriff über diesen Link entzogen wurde. */
  revokedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * Ein Gast mit allem, was er hier darf – zusammengefasst über alle Links,
 * über die er hereinkommt.
 */
export interface GuestAccessDto {
  user: UserSummaryDto;
  /** Gesperrte Konten kommen unabhängig von den Links nicht mehr herein. */
  isActive: boolean;
  links: GuestAccessLinkDto[];
  /** Was am Ende übrig bleibt: Summe der Rechte aus allen gültigen Links. */
  canView: boolean;
  canComment: boolean;
  canDownload: boolean;
  canUpload: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * Ein Gast, den man diesem Projekt hinzufügen könnte, weil er schon bei einem
 * anderen Projekt desselben Kunden dabei ist (Phase 18).
 */
export interface GuestCandidateDto {
  user: UserSummaryDto;
  /** Projekte desselben Kunden, über die er hereinkommt – als Beleg. */
  fromProjects: { id: string; name: string }[];
}

/** Zeile der workspace-weiten Gästeübersicht. */
export interface GuestOverviewDto {
  user: UserSummaryDto;
  isActive: boolean;
  /** Projekte, die dieser Gast erreichen kann. */
  projects: { id: string; name: string; linkCount: number }[];
  linkCount: number;
  activeLinkCount: number;
  createdAt: string;
  lastSeenAt: string | null;
}

/** Was ein Gast über eine Freigabe erfährt, bevor er sich anmeldet. */
export interface SharePreviewDto {
  scope: ShareScope;
  targetName: string;
  projectName: string;
  allowDownload: boolean;
  allowUpload: boolean;
  allowComments: boolean;
  /** `false`, wenn abgelaufen oder zurückgezogen. */
  isActive: boolean;
  /** Ohne eingerichteten Mailversand kann kein Code verschickt werden. */
  mailReady: boolean;
}

/** Ordner im Kunden-Bereich eines Projekts (Phase 15). */
export interface ProjectFolderDto {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  createdAt: string;
}

export interface ProjectFileDto {
  id: string;
  projectId: string;
  /** Ordner im Kunden-Bereich; `null` heißt Wurzelebene (Phase 15). */
  folderId: string | null;
  filename: string;
  sizeBytes: number;
  mimeType: string | null;
  note: string | null;
  uploadedBy: UserSummaryDto | null;
  createdAt: string;
}

/** Ein Eintrag der Benachrichtigungszentrale (Phase 18). */
export interface NotificationDto {
  id: string;
  /** Erwähnung oder gewöhnlicher Kommentar – die Liste hebt Ersteres hervor. */
  mentioned: boolean;
  createdAt: string;
  /** `null`, solange ungelesen. */
  readAt: string | null;
  authorName: string;
  projectName: string;
  videoId: string;
  videoName: string;
  versionLabel: string;
  /** Stelle im Film; `null` bei einem Kommentar ohne Zeitbezug. */
  timecode: string | null;
  /** Anfang des Kommentars, ohne Mention-Auszeichnung. */
  excerpt: string;
  /** Antwort in einem Gespräch? */
  isReply: boolean;
}

/**
 * Ein Eintrag der Spalte „Benachrichtigungen“ (Phase 18): eine Person aus dem
 * Team und die Frage, ob sie zu diesem Projekt oder Video Post bekommt.
 */
export interface NotificationSubscriberDto {
  user: UserSummaryDto;
  /** Genau hier eingetragen – am Video also nur fürs Video. */
  subscribed: boolean;
  /**
   * Kommt übers Projekt und gilt für alle seine Videos. Am Video lässt sich
   * das nicht einzeln abschalten; dafür geht man ins Projekt.
   */
  inherited: boolean;
}

export interface SmtpSettingsDto {
  enabled: boolean;
  provider: string | null;
  host: string | null;
  port: number | null;
  secure: boolean;
  user: string | null;
  /** Das Passwort verlässt den Server nie; hier steht nur, ob eines hinterlegt ist. */
  hasPassword: boolean;
  fromName: string | null;
  fromEmail: string | null;
  /**
   * Ruhezeit in Minuten, bevor eine Sammelmail rausgeht (Phase 18): Erst
   * wenn so lange kein neuer Kommentar mehr kam, wird zugestellt. `0` heißt
   * sofort – dann kommt wie früher eine Mail je Kommentar.
   */
  digestMinutes: number;
  updatedAt: string;
}

/**
 * Was den Umgang mit Projekten betrifft (Phase 20), nur für Admins.
 *
 * Bis Phase 19 hing die Aufbewahrungsfrist mit an den Mail-Einstellungen –
 * technisch dieselbe Zeile in der Datenbank, inhaltlich aber ohne jeden
 * Zusammenhang. Wer sie suchte, suchte lange.
 */
export interface ProjectSettingsDto {
  /**
   * Wie lange die alten Fassungen eines archivierten Projekts liegen bleiben.
   * `0` löscht sie beim nächsten nächtlichen Aufräumen; die neueste bleibt
   * immer.
   */
  archiveRetentionDays: number;
  updatedAt: string;
}

/**
 * Eine Mail, die nicht zugestellt werden konnte (Phase 18). Eine Zeile je
 * Empfänger und Betreff; `attempts` zählt die Versuche der Warteschlange.
 */
export interface MailFailureDto {
  id: string;
  recipient: string;
  subject: string;
  error: string;
  attempts: number;
  firstAt: string;
  lastAt: string;
}

// ---------- Verarbeitung (Phase 19) ----------

/** x264-Presets, langsamste zuletzt. Langsamer heißt kleiner bei gleichem Bild. */
export const X264_PRESETS = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
] as const;
export type X264Preset = (typeof X264_PRESETS)[number];

export const RENDITION_CONTAINERS = ['mp4', 'mov'] as const;
export type RenditionContainer = (typeof RENDITION_CONTAINERS)[number];

/**
 * Wann die Download-Formate entstehen (Phase 20).
 *
 * Vorher waren das zwei voneinander unabhängige Schalter – ein Haken
 * „direkt beim Upload erstellen" und ein Zeitfenster daneben, das für alle
 * Nacharbeit zugleich galt. Beides zusammen ergab Kombinationen, die sich
 * widersprachen (direkt beim Upload *und* nur nachts?). Als eine Auswahl aus
 * drei sich ausschließenden Möglichkeiten kann das nicht mehr passieren.
 */
export const TRANSCODE_TIMINGS = ['on-demand', 'upload', 'schedule'] as const;
export type TranscodeTiming = (typeof TRANSCODE_TIMINGS)[number];

/** Dasselbe für die HLS-Stufenleiter, die zusätzlich ganz aus sein darf. */
export const HLS_MODES = ['off', 'upload', 'schedule'] as const;
export type HlsMode = (typeof HLS_MODES)[number];

/**
 * Vorbelegung, sobald jemand „nach Zeitplan" wählt, ohne Uhrzeiten zu setzen.
 * Ein Zeitplan ohne Zeiten wäre sonst ein Schalter, der nichts tut – genau
 * die Undurchsichtigkeit, die weg soll.
 */
export const DEFAULT_TRANSCODE_WINDOW_START = '22:00';
export const DEFAULT_TRANSCODE_WINDOW_END = '06:00';

/**
 * Ein Download-Format, wie der Admin es angelegt hat (Phase 19). Wer nur
 * herunterlädt, bekommt davon `id`, `name` und `shortEdge` zu sehen – Bitrate
 * und Preset sind Sache der Einrichtung.
 */
export interface DownloadPresetDto {
  id: string;
  name: string;
  /** Kurze Kante: 1080 ist quer 1920×1080 und hoch 1080×1920. */
  shortEdge: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  preset: X264Preset;
  container: RenditionContainer;
  sortOrder: number;
  isActive: boolean;
}

export type RenditionStatus = 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';

/**
 * Ein Format im Download-Fenster. `status` ist `null`, solange niemand es
 * angefordert hat – dann entsteht die Datei erst beim Klick.
 */
export interface VersionRenditionDto {
  presetId: string;
  name: string;
  shortEdge: number;
  container: RenditionContainer;
  status: RenditionStatus | null;
  progress: number;
  error: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  /** Name, unter dem diese Fassung heruntergeladen wird. */
  downloadFilename: string;
}

/** Was das Download-Fenster einer Fassung anbietet (Phase 19). */
export interface VersionDownloadsDto {
  /** Ist die Formatauswahl überhaupt eingeschaltet? */
  formatsEnabled: boolean;
  /** Darf der Fragende überhaupt herunterladen? */
  canDownload: boolean;
  /** Name, unter dem das Original heruntergeladen wird. */
  originalFilename: string;
  originalSizeBytes: number;
  renditions: VersionRenditionDto[];
}

/**
 * Verarbeitungseinstellungen des Workspace (Phase 19), nur für Admins.
 *
 * Die `…Effective`-Felder sagen, was gerade tatsächlich gilt: Solange in der
 * Oberfläche nichts entschieden wurde, kommt der Wert aus der `.env` des
 * Containers. `…FromEnv` markiert genau diesen Fall.
 */
export interface TranscodeSettingsDto {
  downloadFormatsEnabled: boolean;
  downloadFinalOnly: boolean;
  downloadTiming: TranscodeTiming;
  /** `HH:MM` oder `null`. Nur bei `schedule` von Belang. */
  downloadWindowStart: string | null;
  downloadWindowEnd: string | null;
  hlsMode: HlsMode;
  hlsModeFromEnv: boolean;
  hlsWindowStart: string | null;
  hlsWindowEnd: string | null;
  proxyShortEdge: number;
  proxyShortEdgeFromEnv: boolean;
  proxyVideoBitrateKbps: number;
  proxyVideoBitrateFromEnv: boolean;
  proxyPreset: X264Preset;
  proxyPresetFromEnv: boolean;
  presets: DownloadPresetDto[];
  updatedAt: string;
}

/** Vorbelegung der SMTP-Felder je Anbieter (nur Host, Port, TLS). */
export interface SmtpProviderPresetDto {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  hint: string;
}

/** Anmeldeeinstellungen des Workspace (Phase 11), nur für Admins. */
export interface AuthSettingsDto {
  localLoginEnabled: boolean;
  oidcEnabled: boolean;
  tenantId: string | null;
  clientId: string | null;
  /** Das Secret verlässt den Server nie; hier steht nur, ob eines da ist. */
  hasClientSecret: boolean;
  autoProvision: boolean;
  allowedDomains: string[];
  buttonLabel: string;
  /** Diese Adresse muss in der App-Registrierung eingetragen sein. */
  redirectUri: string;
  updatedAt: string;
}

/** Was die Anmeldeseite ohne Anmeldung wissen muss. */
export interface LoginMethodsDto {
  local: boolean;
  microsoft: boolean;
  microsoftLabel: string;
}

export interface LoginResponseDto {
  user: UserDto;
}

/** Antwort nach erfolgreicher Gast-Anmeldung. */
export interface GuestLoginResponseDto {
  user: UserDto;
  share: SharePreviewDto;
  /** Wohin die Oberfläche nach der Anmeldung springt. */
  redirectPath: string;
  /**
   * Beim allerersten Anmelden fehlt der Name noch (Phase 20). Die Sitzung
   * steht dann schon – gefragt wird einmal, danach nie wieder.
   */
  needsName: boolean;
}

export interface ApiErrorDto {
  statusCode: number;
  message: string | string[];
  error?: string;
}

/**
 * Was ein eingebetteter Player über sich wissen muss. Bewusst wenig: kein
 * Projekt, keine Kommentare, keine Gäste – nur das, was zum Abspielen nötig
 * ist.
 */
export interface EmbedDto {
  title: string;
  versionId: string;
  /** `v2` oder `v2.5`, für die dezente Beschriftung. */
  versionLabel: string;
  /** Endfassung (Phase 17)? Ohne Haken steht „Vorschau" in der Leiste. */
  isFinal: boolean;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  hasPoster: boolean;
  /** Titel des Workspace – erscheint klein in der Ecke. */
  brandTitle: string;
}
