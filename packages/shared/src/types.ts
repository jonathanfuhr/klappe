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
  targetName: string;
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
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  hasPoster: boolean;
  /** Titel des Workspace – erscheint klein in der Ecke. */
  brandTitle: string;
}
