/**
 * Postgres-Schema (Drizzle). Aus dieser Datei werden die SQL-Migrationen in
 * `drizzle/` erzeugt: `npm run db:generate -w @klappe/api`.
 *
 * Aufbau nach der Hierarchie aus dem Konzept: Projekt → Video → Version.
 * Kommentare hängen an einer Version, nicht am Video – ein Kommentar auf
 * Frame 812 meint immer eine bestimmte Fassung.
 */
import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['ADMIN', 'MEMBER', 'GUEST']);
export const versionStatusEnum = pgEnum('version_status', [
  'UPLOADING',
  'PROCESSING',
  'READY',
  'FAILED',
]);
export const uploadStatusEnum = pgEnum('upload_status', ['IN_PROGRESS', 'COMPLETED', 'ABORTED']);
/** Wohin ein Upload gehört: eine Videoversion oder der Kunden-Ordner eines Projekts. */
export const uploadKindEnum = pgEnum('upload_kind', ['VERSION', 'PROJECT_FILE']);
export const shareScopeEnum = pgEnum('share_scope', ['PROJECT', 'VIDEO']);
/** Wie das Material fürs Abspielen bereitsteht (siehe `transcode/media-plan.ts`). */
export const playbackModeEnum = pgEnum('playback_mode', ['ORIGINAL', 'REMUX', 'TRANSCODE']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Immer kleingeschrieben gespeichert, damit der Login unabhängig von der Schreibweise trifft. */
    email: text('email').notNull(),
    name: text('name').notNull(),
    /** `null` bei Konten ohne lokales Passwort (Gäste, später M365-SSO). */
    passwordHash: text('password_hash'),
    role: userRoleEnum('role').notNull().default('MEMBER'),
    isActive: boolean('is_active').notNull().default(true),
    notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Kunde hinter dem Projekt – geht in die Download-Dateinamen ein. */
    customer: text('customer'),
    description: text('description'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('projects_created_at_idx').on(table.createdAt)],
);

export const videos = pgTable(
  'videos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Schalter für das ganze Video; wirkt zusätzlich zum Recht am Share-Link. */
    downloadsEnabled: boolean('downloads_enabled').notNull().default(true),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [index('videos_project_idx').on(table.projectId, table.sortOrder)],
);

export const videoVersions = pgTable(
  'video_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    /** Fortlaufend ab 1, pro Video eindeutig. */
    versionNumber: integer('version_number').notNull(),
    label: text('label'),
    status: versionStatusEnum('status').notNull().default('UPLOADING'),
    /** Fortschritt des Transcodings in Prozent (0–100). */
    progress: smallint('progress').notNull().default(0),
    processingError: text('processing_error'),
    processingStartedAt: timestamp('processing_started_at', { withTimezone: true }),
    processingFinishedAt: timestamp('processing_finished_at', { withTimezone: true }),

    uploadedById: uuid('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    /** Schalter für diese eine Fassung, z. B. wenn nur v3 raus darf. */
    downloadEnabled: boolean('download_enabled').notNull().default(true),

    // Original – wird für Downloads immer unverändert ausgeliefert.
    originalFilename: text('original_filename').notNull(),
    originalSizeBytes: bigint('original_size_bytes', { mode: 'number' }).notNull(),
    originalMimeType: text('original_mime_type'),
    originalKey: text('original_key'),
    /**
     * Datum der Fassung im Dateinamen (JJMMTT). Kommt beim Upload vom
     * Tagesdatum und lässt sich dort ändern – der Schnitt von gestern soll
     * nicht das Datum des Hochladens tragen.
     */
    fileDate: date('file_date'),

    // Von ffprobe gelesene Kennwerte – Grundlage des Frame-Counters.
    durationSeconds: doublePrecision('duration_seconds'),
    frameCount: integer('frame_count'),
    fpsNum: integer('fps_num'),
    fpsDen: integer('fps_den'),
    dropFrame: boolean('drop_frame').notNull().default(false),
    startTimecode: text('start_timecode'),
    startTimecodeFrames: integer('start_timecode_frames').notNull().default(0),
    width: integer('width'),
    height: integer('height'),
    videoCodec: text('video_codec'),
    audioCodec: text('audio_codec'),
    pixelFormat: text('pixel_format'),
    formatName: text('format_name'),
    bitrateBps: bigint('bitrate_bps', { mode: 'number' }),

    // Abgeleitete Dateien aus der Pipeline.
    playbackMode: playbackModeEnum('playback_mode'),
    /** Warum so entschieden wurde – für die Anzeige und die Fehlersuche. */
    playbackReason: text('playback_reason'),
    proxyKey: text('proxy_key'),
    proxyWidth: integer('proxy_width'),
    proxyHeight: integer('proxy_height'),
    proxySizeBytes: bigint('proxy_size_bytes', { mode: 'number' }),
    posterKey: text('poster_key'),
    spriteKey: text('sprite_key'),
    spriteColumns: integer('sprite_columns'),
    spriteRows: integer('sprite_rows'),
    spriteTileWidth: integer('sprite_tile_width'),
    spriteTileHeight: integer('sprite_tile_height'),
    spriteTileCount: integer('sprite_tile_count'),
    spriteIntervalSeconds: doublePrecision('sprite_interval_seconds'),

    ...timestamps,
  },
  (table) => [
    uniqueIndex('video_versions_number_unique').on(table.videoId, table.versionNumber),
    index('video_versions_video_idx').on(table.videoId),
  ],
);

/**
 * Laufende Upload-Sitzung nach tus-Semantik. Der Offset in dieser Tabelle ist
 * die Wahrheit gegenüber dem Client; die Datei auf der Platte wird nur
 * angehängt, wenn der Offset des Clients dazu passt.
 */
export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: uploadKindEnum('kind').notNull().default('VERSION'),
    // Je nach Art ist entweder video/version gesetzt (neue Fassung) oder
    // project (Datei im Kunden-Ordner).
    videoId: uuid('video_id').references(() => videos.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id').references(() => videoVersions.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    filename: text('filename').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    offsetBytes: bigint('offset_bytes', { mode: 'number' }).notNull().default(0),
    storageKey: text('storage_key').notNull(),
    status: uploadStatusEnum('status').notNull().default('IN_PROGRESS'),
    metadata: jsonb('metadata').$type<Record<string, string>>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index('uploads_video_idx').on(table.videoId), index('uploads_status_idx').on(table.status)],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => videoVersions.id, { onDelete: 'cascade' }),
    /** Gesetzt bei Antworten; Antworten hängen immer am Wurzelkommentar. */
    parentId: uuid('parent_id'),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    /** `null` = allgemeiner Kommentar ohne Frame-Bezug. */
    frame: integer('frame'),
    /**
     * Zeichnung auf dem Videobild, Koordinaten normalisiert auf 0…1
     * (siehe `packages/shared/src/annotations.ts`). Als JSONB, weil sie immer
     * als Ganzes zu genau diesem Kommentar gehört.
     */
    annotation: jsonb('annotation').$type<{ strokes: unknown[] }>(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedById: uuid('resolved_by_id').references(() => users.id, { onDelete: 'set null' }),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'comments_parent_id_fk',
    }).onDelete('cascade'),
    index('comments_version_frame_idx').on(table.versionId, table.frame),
    index('comments_parent_idx').on(table.parentId),
  ],
);

export const commentMentions = pgTable(
  'comment_mentions',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.commentId, table.userId] }),
    index('comment_mentions_user_idx').on(table.userId),
  ],
);

/**
 * Freigabe-Link auf ein Projekt oder ein einzelnes Video.
 *
 * Eine Projektfreigabe schließt alle enthaltenen Videos ein – auch die, die
 * erst später dazukommen. Das ist Absicht: Der Kunde bekommt einen Link und
 * sieht darüber den laufenden Stand.
 */
export const shareLinks = pgTable(
  'share_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Zufälliger Teil der URL; nur dieser Wert ist das Geheimnis. */
    token: text('token').notNull(),
    scope: shareScopeEnum('scope').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    videoId: uuid('video_id').references(() => videos.id, { onDelete: 'cascade' }),
    label: text('label'),
    /** Ohne dieses Recht sieht der Gast keinen Download-Knopf. */
    allowDownload: boolean('allow_download').notNull().default(false),
    /** Erlaubt dem Gast, Material in den Kunden-Ordner des Projekts zu legen. */
    allowUpload: boolean('allow_upload').notNull().default(false),
    /** Erlaubt dem Gast das Kommentieren. */
    allowComments: boolean('allow_comments').notNull().default(true),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('share_links_token_unique').on(table.token),
    index('share_links_project_idx').on(table.projectId),
    index('share_links_video_idx').on(table.videoId),
  ],
);

/**
 * Welcher Gast hat sich über welchen Link angemeldet. Daraus ergibt sich sein
 * Zugriff – und die Gästeübersicht pro Projekt und Video.
 */
export const shareLinkGrants = pgTable(
  'share_link_grants',
  {
    shareLinkId: uuid('share_link_id')
      .notNull()
      .references(() => shareLinks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Gesetzt, wenn einem einzelnen Gast der Zugriff entzogen wurde. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.shareLinkId, table.userId] }),
    index('share_link_grants_user_idx').on(table.userId),
  ],
);

/** Einmal-Code für die passwortlose Anmeldung von Gästen. */
export const loginCodes = pgTable(
  'login_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    /** Der Code steht nur gehasht in der Datenbank. */
    codeHash: text('code_hash').notNull(),
    shareLinkId: uuid('share_link_id').references(() => shareLinks.id, { onDelete: 'cascade' }),
    /** Der beim Anfordern angegebene Name; wird beim Einlösen übernommen. */
    name: text('name'),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('login_codes_email_idx').on(table.email, table.createdAt)],
);

/** Datei im Kunden-Upload-Ordner eines Projekts (Phase 7). */
export const projectFiles = pgTable(
  'project_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    uploadedById: uuid('uploaded_by_id').references(() => users.id, { onDelete: 'set null' }),
    /** Über welchen Freigabe-Link die Datei kam – für die Nachvollziehbarkeit. */
    shareLinkId: uuid('share_link_id').references(() => shareLinks.id, { onDelete: 'set null' }),
    filename: text('filename').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    mimeType: text('mime_type'),
    storageKey: text('storage_key').notNull(),
    note: text('note'),
    ...timestamps,
  },
  (table) => [index('project_files_project_idx').on(table.projectId, table.createdAt)],
);

/**
 * Einstellungen des Workspace. Genau eine Zeile (`id = 1`) – der Container
 * betreibt laut Konzept genau einen Workspace.
 */
export const appSettings = pgTable('app_settings', {
  id: integer('id').primaryKey().default(1),
  smtpEnabled: boolean('smtp_enabled').notNull().default(false),
  smtpProvider: text('smtp_provider'),
  smtpHost: text('smtp_host'),
  smtpPort: integer('smtp_port'),
  /** Implizites TLS (Port 465). Sonst STARTTLS. */
  smtpSecure: boolean('smtp_secure').notNull().default(false),
  smtpUser: text('smtp_user'),
  /** Verschlüsselt abgelegt, siehe `common/secret-box.ts`. */
  smtpPasswordEncrypted: text('smtp_password_encrypted'),
  smtpFromName: text('smtp_from_name'),
  smtpFromEmail: text('smtp_from_email'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  comments: many(comments),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  createdBy: one(users, { fields: [projects.createdById], references: [users.id] }),
  videos: many(videos),
  files: many(projectFiles),
  shareLinks: many(shareLinks),
}));

export const shareLinksRelations = relations(shareLinks, ({ one, many }) => ({
  project: one(projects, { fields: [shareLinks.projectId], references: [projects.id] }),
  video: one(videos, { fields: [shareLinks.videoId], references: [videos.id] }),
  createdBy: one(users, { fields: [shareLinks.createdById], references: [users.id] }),
  grants: many(shareLinkGrants),
}));

export const shareLinkGrantsRelations = relations(shareLinkGrants, ({ one }) => ({
  shareLink: one(shareLinks, { fields: [shareLinkGrants.shareLinkId], references: [shareLinks.id] }),
  user: one(users, { fields: [shareLinkGrants.userId], references: [users.id] }),
}));

export const projectFilesRelations = relations(projectFiles, ({ one }) => ({
  project: one(projects, { fields: [projectFiles.projectId], references: [projects.id] }),
  uploadedBy: one(users, { fields: [projectFiles.uploadedById], references: [users.id] }),
}));

export const videosRelations = relations(videos, ({ one, many }) => ({
  project: one(projects, { fields: [videos.projectId], references: [projects.id] }),
  createdBy: one(users, { fields: [videos.createdById], references: [users.id] }),
  versions: many(videoVersions),
}));

export const videoVersionsRelations = relations(videoVersions, ({ one, many }) => ({
  video: one(videos, { fields: [videoVersions.videoId], references: [videos.id] }),
  uploadedBy: one(users, { fields: [videoVersions.uploadedById], references: [users.id] }),
  comments: many(comments),
}));

export const commentsRelations = relations(comments, ({ one, many }) => ({
  version: one(videoVersions, { fields: [comments.versionId], references: [videoVersions.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
  parent: one(comments, { fields: [comments.parentId], references: [comments.id], relationName: 'thread' }),
  replies: many(comments, { relationName: 'thread' }),
  mentions: many(commentMentions),
}));

export const commentMentionsRelations = relations(commentMentions, ({ one }) => ({
  comment: one(comments, { fields: [commentMentions.commentId], references: [comments.id] }),
  user: one(users, { fields: [commentMentions.userId], references: [users.id] }),
}));

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type ProjectRow = typeof projects.$inferSelect;
export type VideoRow = typeof videos.$inferSelect;
export type VideoVersionRow = typeof videoVersions.$inferSelect;
export type UploadRow = typeof uploads.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type ShareLinkRow = typeof shareLinks.$inferSelect;
export type ShareLinkGrantRow = typeof shareLinkGrants.$inferSelect;
export type LoginCodeRow = typeof loginCodes.$inferSelect;
export type ProjectFileRow = typeof projectFiles.$inferSelect;
export type AppSettingsRow = typeof appSettings.$inferSelect;
