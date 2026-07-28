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

    // Original – wird für Downloads immer unverändert ausgeliefert.
    originalFilename: text('original_filename').notNull(),
    originalSizeBytes: bigint('original_size_bytes', { mode: 'number' }).notNull(),
    originalMimeType: text('original_mime_type'),
    originalKey: text('original_key'),

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
    bitrateBps: bigint('bitrate_bps', { mode: 'number' }),

    // Abgeleitete Dateien aus der Pipeline.
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
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => videoVersions.id, { onDelete: 'cascade' }),
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

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  comments: many(comments),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  createdBy: one(users, { fields: [projects.createdById], references: [users.id] }),
  videos: many(videos),
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
