import type {
  Annotation,
  AuthSettingsDto,
  BrandingDto,
  CommentDto,
  CustomerDto,
  FieldValueCountDto,
  GuestAccessDto,
  GuestCandidateDto,
  GuestLoginResponseDto,
  GuestOverviewDto,
  LoginMethodsDto,
  LoginResponseDto,
  NotificationDto,
  NotificationSubscriberDto,
  ProjectDto,
  ProjectFieldDefDto,
  ProjectFieldSettingsDto,
  ProjectFileDto,
  ProjectFolderDto,
  ShareGuestDto,
  ShareLinkDto,
  SharePreviewDto,
  ShareScope,
  SmtpProviderPresetDto,
  SmtpSettingsDto,
  TagDto,
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

  listProjects: (
    options: {
      tagIds?: string[];
      tagMatch?: 'any' | 'all';
      sort?: string;
      /** Mehrere Kunden = einer genügt (Phase 16). */
      customers?: string[];
      /** Je Feld die gewählten Werte; Felder untereinander UND. */
      fieldFilters?: { fieldId: string; values: string[] }[];
    } = {},
  ) => {
    const query = new URLSearchParams();
    if (options.tagIds?.length) query.set('tags', options.tagIds.join(','));
    if (options.tagMatch) query.set('tagMatch', options.tagMatch);
    if (options.sort) query.set('sort', options.sort);
    for (const kunde of options.customers ?? []) query.append('customer', kunde);
    for (const filter of options.fieldFilters ?? []) {
      for (const wert of filter.values) query.append('field', `${filter.fieldId}:${wert}`);
    }
    const suffix = query.toString();
    return request<ProjectDto[]>(`/v1/projects${suffix ? `?${suffix}` : ''}`);
  },
  listCustomers: () => request<CustomerDto[]>('/v1/projects/customers'),
  listProjectFields: () => request<ProjectFieldDefDto[]>('/v1/project-fields'),
  createProjectField: (name: string) =>
    request<ProjectFieldDefDto>('/v1/project-fields', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  listProjectFieldValues: (fieldId: string) =>
    request<FieldValueCountDto[]>(`/v1/project-fields/${fieldId}/values`),
  getProjectFieldSettings: () =>
    request<ProjectFieldSettingsDto>('/v1/project-fields/settings'),
  updateProjectFieldSettings: (input: { tagsEnabled?: boolean }) =>
    request<ProjectFieldSettingsDto>('/v1/project-fields/settings', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  updateProjectField: (id: string, input: { name?: string; sortOrder?: number; suggest?: boolean }) =>
    request<ProjectFieldDefDto>(`/v1/project-fields/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteProjectField: (id: string) =>
    request<void>(`/v1/project-fields/${id}`, { method: 'DELETE' }),
  /** Leere Werte löschen den Eintrag am Projekt. */
  setProjectFieldValues: (projectId: string, values: { fieldId: string; value: string }[]) =>
    request<ProjectDto>(`/v1/projects/${projectId}/fields`, {
      method: 'PUT',
      body: JSON.stringify({ values }),
    }),
  /** `nach` weglassen entfernt den Kundennamen von allen Projekten. */
  renameCustomer: (von: string, nach?: string) =>
    request<{ projectCount: number }>('/v1/projects/customers', {
      method: 'PATCH',
      body: JSON.stringify({ von, ...(nach ? { nach } : {}) }),
    }),
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
    input: { label?: string; downloadEnabled?: boolean; fileDate?: string; isFinal?: boolean },
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
      versionNumber?: number;
    },
  ) =>
    request<UploadSessionDto>(`/v1/videos/${videoId}/uploads`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** Sitzung ohne Ziel – Projekt und Video kommen später. */
  /** Fertig übertragene, noch unzugeordnete Sitzungen – für den Reload (Phase 15). */
  listUnassignedUploads: () => request<UploadSessionDto[]>('/v1/uploads'),
  /** Eine Sitzung nachfragen – wegen des Verarbeitungsfortschritts (Phase 18). */
  getUpload: (id: string) => request<UploadSessionDto>(`/v1/uploads/${id}`),
  createUnassignedUpload: (input: { filename: string; sizeBytes: number; mimeType?: string }) =>
    request<UploadSessionDto>('/v1/uploads', { method: 'POST', body: JSON.stringify(input) }),
  /**
   * Zuordnung nachreichen. Ist die Datei schon vollständig übertragen, entsteht
   * dabei die Fassung – die Kennung steht dann im zurückgegebenen `versionId`.
   */
  assignUpload: (
    uploadId: string,
    input: { videoId?: string; label?: string; fileDate?: string; versionNumber?: number },
  ) =>
    request<UploadSessionDto>(`/v1/uploads/${uploadId}/ziel`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  createProjectFileUpload: (
    projectId: string,
    input: { filename: string; sizeBytes: number; mimeType?: string; folderId?: string },
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
      embedEnabled?: boolean;
      revoked?: boolean;
    },
  ) => request<ShareLinkDto>(`/v1/shares/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteShare: (id: string) => request<void>(`/v1/shares/${id}`, { method: 'DELETE' }),
  listShareGuests: (id: string) => request<ShareGuestDto[]>(`/v1/shares/${id}/guests`),
  /** Rechte einer Person an einem Link; `null` = wie der Link (Phase 16). */
  setShareGuestRights: (
    shareLinkId: string,
    userId: string,
    rechte: {
      allowComments?: boolean | null;
      allowDownload?: boolean | null;
      allowUpload?: boolean | null;
    },
  ) =>
    request<void>(`/v1/shares/${shareLinkId}/guests/${userId}/rechte`, {
      method: 'PATCH',
      body: JSON.stringify(rechte),
    }),
  setShareGuestRevoked: (id: string, userId: string, revoked: boolean) =>
    request<void>(`/v1/shares/${id}/guests/${userId}`, { method: revoked ? 'DELETE' : 'POST' }),

  // ---------- Gäste- und Rechteübersicht (Phase 9) ----------
  listProjectGuests: (projectId: string) =>
    request<GuestAccessDto[]>(`/v1/projects/${projectId}/guests`),
  listVideoGuests: (videoId: string) => request<GuestAccessDto[]>(`/v1/videos/${videoId}/guests`),
  listAllGuests: () => request<GuestOverviewDto[]>('/v1/guests'),
  setProjectGuestRevoked: (projectId: string, userId: string, revoked: boolean) =>
    request<GuestAccessDto[]>(`/v1/projects/${projectId}/guests/${userId}`, {
      method: revoked ? 'DELETE' : 'POST',
    }),
  /**
   * Gäste aus Projekten desselben Kunden – wen man diesem Projekt noch
   * hinzufügen könnte (Phase 18).
   */
  listGuestCandidates: (projectId: string) =>
    request<GuestCandidateDto[]>(`/v1/projects/${projectId}/gastkandidaten`),
  /**
   * Einen vorhandenen Gast erweitern – aufs ganze Projekt oder auf weitere
   * Videos. Ohne neuen Link, ohne neue Mail (Phase 18).
   */
  extendProjectGuest: (
    projectId: string,
    userId: string,
    input: { scope: 'PROJECT' } | { scope: 'VIDEO'; videoIds: string[] },
  ) =>
    request<GuestAccessDto[]>(`/v1/projects/${projectId}/guests/${userId}/erweitern`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  setGuestActive: (userId: string, isActive: boolean) =>
    request<GuestOverviewDto[]>(`/v1/guests/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),

  // ---------- Benachrichtigungszentrale (Phase 18) ----------
  listNotifications: (limit = 50) =>
    request<NotificationDto[]>(`/v1/notifications?limit=${limit}`),
  unreadNotifications: () => request<{ unread: number }>('/v1/notifications/count'),
  /** Ohne `ids` gilt alles als gelesen. */
  markNotificationsRead: (ids?: string[]) =>
    request<{ unread: number }>('/v1/notifications/read', {
      method: 'POST',
      body: JSON.stringify(ids ? { ids } : {}),
    }),

  // ---------- Benachrichtigungen je Projekt und Video (Phase 18) ----------
  listProjectSubscribers: (projectId: string) =>
    request<NotificationSubscriberDto[]>(`/v1/projects/${projectId}/notifications`),
  setProjectSubscriber: (projectId: string, userId: string, subscribed: boolean) =>
    request<NotificationSubscriberDto[]>(`/v1/projects/${projectId}/notifications/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ subscribed }),
    }),
  listVideoSubscribers: (videoId: string) =>
    request<NotificationSubscriberDto[]>(`/v1/videos/${videoId}/notifications`),
  setVideoSubscriber: (videoId: string, userId: string, subscribed: boolean) =>
    request<NotificationSubscriberDto[]>(`/v1/videos/${videoId}/notifications/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ subscribed }),
    }),

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
  listProjectFolders: (projectId: string) =>
    request<ProjectFolderDto[]>(`/v1/projects/${projectId}/folders`),
  /** Legt eine Ordnerkette an (idempotent); „Neuer Ordner" ist ein Pfad der Länge 1. */
  ensureProjectFolderPath: (projectId: string, input: { parentId?: string; path: string[] }) =>
    request<ProjectFolderDto>(`/v1/projects/${projectId}/folders`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  renameProjectFolder: (id: string, name: string) =>
    request<ProjectFolderDto>(`/v1/folders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  /** Löscht den Ordner samt Unterordnern und Dateien. */
  deleteProjectFolder: (id: string) => request<void>(`/v1/folders/${id}`, { method: 'DELETE' }),

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
    digestMinutes?: number;
  }) => request<SmtpSettingsDto>('/v1/settings/smtp', { method: 'PUT', body: JSON.stringify(input) }),
  smtpPresets: () => request<SmtpProviderPresetDto[]>('/v1/settings/smtp/presets'),

  // ---------- Schlagworte (Phase 12) ----------
  listTags: () => request<TagDto[]>('/v1/tags'),
  createTag: (input: { name: string; color?: string }) =>
    request<TagDto>('/v1/tags', { method: 'POST', body: JSON.stringify(input) }),
  updateTag: (id: string, input: { name?: string; color?: string }) =>
    request<TagDto>(`/v1/tags/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  deleteTag: (id: string) => request<void>(`/v1/tags/${id}`, { method: 'DELETE' }),
  setProjectTags: (projectId: string, tagIds: string[]) =>
    request<void>(`/v1/projects/${projectId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tagIds }),
    }),

  // ---------- Anmeldewege (Phase 11) ----------
  loginMethods: () => request<LoginMethodsDto>('/v1/auth/methods'),
  getAuthSettings: () => request<AuthSettingsDto>('/v1/settings/auth'),
  updateAuthSettings: (input: {
    localLoginEnabled?: boolean;
    oidcEnabled?: boolean;
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    autoProvision?: boolean;
    allowedDomains?: string;
    buttonLabel?: string;
  }) => request<AuthSettingsDto>('/v1/settings/auth', { method: 'PUT', body: JSON.stringify(input) }),

  // ---------- Erscheinungsbild (Phase 10) ----------
  getBranding: () => request<BrandingDto>('/v1/branding'),
  updateBranding: (input: { title?: string; accent?: string }) =>
    request<BrandingDto>('/v1/settings/branding', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  /**
   * Rohe Bytes; das Format steht im Content-Type der Datei selbst. Die
   * Schreibweise des Kopfzeilennamens muss zur Voreinstellung in `request`
   * passen, sonst stehen am Ende zwei Content-Type-Angaben in der Anfrage.
   */
  uploadLogo: (file: File) =>
    request<BrandingDto>('/v1/settings/branding/logo', {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    }),
  removeLogo: () => request<BrandingDto>('/v1/settings/branding/logo', { method: 'DELETE' }),
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
  /** Der ganze Kunden-Bereich (oder ein Ordner) als ZIP. */
  projectFilesZip: (projectId: string, folderId?: string | null) =>
    `${API_BASE}/v1/projects/${projectId}/files.zip${folderId ? `?folder=${folderId}` : ''}`,
  /** Master-Playlist der adaptiven Wiedergabe (Phase 13). */
  hls: (versionId: string) => `${API_BASE}/v1/versions/${versionId}/hls/master.m3u8`,
};
