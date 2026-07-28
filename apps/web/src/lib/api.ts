import type {
  Annotation,
  CommentDto,
  GuestLoginResponseDto,
  LoginResponseDto,
  ProjectDto,
  ProjectFileDto,
  ShareGuestDto,
  ShareLinkDto,
  SharePreviewDto,
  ShareScope,
  SmtpProviderPresetDto,
  SmtpSettingsDto,
  UploadSessionDto,
  UserDto,
  UserRole,
  UserSummaryDto,
  VersionDto,
  VideoDto,
} from '@klappe/shared';

/**
 * Leer = gleiche Herkunft; die Next-Rewrites in `next.config.mjs` leiten
 * `/v1/*` an die API weiter. Wer API und Web getrennt veröffentlicht, setzt
 * `NEXT_PUBLIC_API_BASE` auf die öffentliche API-Adresse.
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    // Ohne Cookie keine Sitzung – auch bei gleicher Herkunft explizit setzen.
    credentials: 'include',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    throw new ApiError(response.status, extractMessage(payload) ?? `Fehler ${response.status}`);
  }
  return payload as T;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message: unknown }).message;
    if (Array.isArray(message)) return message.join(' ');
    if (typeof message === 'string') return message;
  }
  return null;
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponseDto>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>('/v1/auth/logout', { method: 'POST' }),
  me: () => request<UserDto>('/v1/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/v1/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  listProjects: () => request<ProjectDto[]>('/v1/projects'),
  getProject: (id: string) => request<ProjectDto>(`/v1/projects/${id}`),
  createProject: (input: { name: string; customer?: string; description?: string }) =>
    request<ProjectDto>('/v1/projects', { method: 'POST', body: JSON.stringify(input) }),
  updateProject: (id: string, input: { name?: string; customer?: string; description?: string }) =>
    request<ProjectDto>(`/v1/projects/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteProject: (id: string) => request<void>(`/v1/projects/${id}`, { method: 'DELETE' }),

  listVideos: (projectId: string) => request<VideoDto[]>(`/v1/projects/${projectId}/videos`),
  getVideo: (id: string) => request<VideoDto>(`/v1/videos/${id}`),
  createVideo: (projectId: string, input: { name: string; description?: string }) =>
    request<VideoDto>(`/v1/projects/${projectId}/videos`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateVideo: (
    id: string,
    input: { name?: string; description?: string; downloadsEnabled?: boolean },
  ) => request<VideoDto>(`/v1/videos/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteVideo: (id: string) => request<void>(`/v1/videos/${id}`, { method: 'DELETE' }),

  listVersions: (videoId: string) => request<VersionDto[]>(`/v1/videos/${videoId}/versions`),
  getVersion: (id: string) => request<VersionDto>(`/v1/versions/${id}`),
  updateVersion: (
    id: string,
    input: { label?: string; downloadEnabled?: boolean; fileDate?: string },
  ) =>
    request<VersionDto>(`/v1/versions/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteVersion: (id: string) => request<void>(`/v1/versions/${id}`, { method: 'DELETE' }),

  createUpload: (
    videoId: string,
    input: {
      filename: string;
      sizeBytes: number;
      mimeType?: string;
      label?: string;
      fileDate?: string;
    },
  ) =>
    request<UploadSessionDto>(`/v1/videos/${videoId}/uploads`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  createProjectFileUpload: (
    projectId: string,
    input: { filename: string; sizeBytes: number; mimeType?: string },
  ) =>
    request<UploadSessionDto>(`/v1/projects/${projectId}/uploads`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  abortUpload: (uploadId: string) => request<void>(`/v1/uploads/${uploadId}`, { method: 'DELETE' }),

  listComments: (versionId: string) => request<CommentDto[]>(`/v1/versions/${versionId}/comments`),
  createComment: (
    versionId: string,
    input: {
      body: string;
      frame?: number | null;
      parentId?: string;
      annotation?: Annotation | null;
    },
  ) =>
    request<CommentDto>(`/v1/versions/${versionId}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        body: input.body,
        ...(input.frame === null || input.frame === undefined ? {} : { frame: input.frame }),
        ...(input.parentId ? { parentId: input.parentId } : {}),
        ...(input.annotation ? { annotation: input.annotation } : {}),
      }),
    }),
  updateComment: (id: string, body: string) =>
    request<CommentDto>(`/v1/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  deleteComment: (id: string) => request<void>(`/v1/comments/${id}`, { method: 'DELETE' }),
  setCommentResolved: (id: string, resolved: boolean) =>
    request<CommentDto>(`/v1/comments/${id}/resolve`, { method: resolved ? 'POST' : 'DELETE' }),

  listUsers: () => request<UserDto[]>('/v1/users'),
  createUser: (input: { email: string; name: string; password: string; role?: UserRole }) =>
    request<UserDto>('/v1/users', { method: 'POST', body: JSON.stringify(input) }),
  updateUser: (
    id: string,
    input: { name?: string; role?: UserRole; isActive?: boolean; password?: string },
  ) => request<UserDto>(`/v1/users/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  mentionableUsers: (query: string) =>
    request<UserSummaryDto[]>(`/v1/mentionable-users?q=${encodeURIComponent(query)}`),
  unsubscribe: (token: string) =>
    request<{ ok: boolean }>('/v1/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  // ---------- Freigaben (Phase 6) ----------
  listProjectShares: (projectId: string) =>
    request<ShareLinkDto[]>(`/v1/projects/${projectId}/shares`),
  listVideoShares: (videoId: string) => request<ShareLinkDto[]>(`/v1/videos/${videoId}/shares`),
  createShare: (input: {
    scope: ShareScope;
    projectId?: string;
    videoId?: string;
    label?: string;
    allowDownload?: boolean;
    allowUpload?: boolean;
    allowComments?: boolean;
    expiresAt?: string;
  }) => request<ShareLinkDto>('/v1/shares', { method: 'POST', body: JSON.stringify(input) }),
  updateShare: (
    id: string,
    input: {
      label?: string;
      allowDownload?: boolean;
      allowUpload?: boolean;
      allowComments?: boolean;
      revoked?: boolean;
    },
  ) => request<ShareLinkDto>(`/v1/shares/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteShare: (id: string) => request<void>(`/v1/shares/${id}`, { method: 'DELETE' }),
  listShareGuests: (id: string) => request<ShareGuestDto[]>(`/v1/shares/${id}/guests`),
  setShareGuestRevoked: (id: string, userId: string, revoked: boolean) =>
    request<void>(`/v1/shares/${id}/guests/${userId}`, { method: revoked ? 'DELETE' : 'POST' }),

  // ---------- Gastzugang ----------
  sharePreview: (token: string) => request<SharePreviewDto>(`/v1/share/${token}`),
  requestGuestCode: (token: string, input: { name: string; email: string }) =>
    request<void>(`/v1/share/${token}/code`, { method: 'POST', body: JSON.stringify(input) }),
  verifyGuestCode: (token: string, input: { email: string; code: string }) =>
    request<GuestLoginResponseDto>(`/v1/share/${token}/verify`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // ---------- Kundendateien (Phase 7) ----------
  listProjectFiles: (projectId: string) =>
    request<ProjectFileDto[]>(`/v1/projects/${projectId}/files`),
  deleteProjectFile: (id: string) => request<void>(`/v1/project-files/${id}`, { method: 'DELETE' }),

  // ---------- E-Mail (Phase 8) ----------
  getSmtpSettings: () => request<SmtpSettingsDto>('/v1/settings/smtp'),
  updateSmtpSettings: (input: {
    enabled?: boolean;
    provider?: string;
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    password?: string;
    fromName?: string;
    fromEmail?: string;
  }) => request<SmtpSettingsDto>('/v1/settings/smtp', { method: 'PUT', body: JSON.stringify(input) }),
  smtpPresets: () => request<SmtpProviderPresetDto[]>('/v1/settings/smtp/presets'),
  sendTestMail: (to?: string) =>
    request<void>('/v1/settings/smtp/test', {
      method: 'POST',
      body: JSON.stringify(to ? { to } : {}),
    }),
};

export const mediaUrl = {
  proxy: (versionId: string) => `${API_BASE}/v1/versions/${versionId}/proxy`,
  poster: (versionId: string) => `${API_BASE}/v1/versions/${versionId}/poster`,
  sprite: (versionId: string) => `${API_BASE}/v1/versions/${versionId}/sprite`,
  original: (versionId: string) => `${API_BASE}/v1/versions/${versionId}/original`,
  projectFile: (fileId: string) => `${API_BASE}/v1/project-files/${fileId}/download`,
};
