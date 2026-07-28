/**
 * Gemeinsame Typen der HTTP-Schnittstelle. API und Web-App benutzen exakt
 * diese Formen – damit bricht ein Feldwechsel im Backend sofort den Typecheck
 * im Frontend.
 */
import type { FrameRate } from './timecode';

export const USER_ROLES = ['ADMIN', 'MEMBER', 'GUEST'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const VERSION_STATUSES = ['UPLOADING', 'PROCESSING', 'READY', 'FAILED'] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

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
  description: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: UserSummaryDto | null;
  videoCount: number;
}

export interface UserSummaryDto {
  id: string;
  name: string;
  email: string;
}

export interface VideoDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: UserSummaryDto | null;
  versionCount: number;
  latestVersion: VersionDto | null;
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
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  mentions: UserSummaryDto[];
  replies: CommentDto[];
}

export interface UploadSessionDto {
  id: string;
  videoId: string;
  versionId: string;
  filename: string;
  sizeBytes: number;
  offsetBytes: number;
  status: UploadStatus;
  /** Absoluter Pfad für `PATCH`/`HEAD` nach tus-Semantik. */
  location: string;
  createdAt: string;
  expiresAt: string;
}

export interface LoginResponseDto {
  user: UserDto;
}

export interface ApiErrorDto {
  statusCode: number;
  message: string | string[];
  error?: string;
}
