/**
 * Postgres-Schema (Drizzle). Aus dieser Datei werden die SQL-Migrationen in
 * `drizzle/` erzeugt: `npm run db:generate -w @klappe/api`.
 *
 * Aufbau nach der Hierarchie aus dem Konzept: Projekt → Video → Version.
 * Kommentare hängen an einer Version, nicht am Video – ein Kommentar auf
 * Frame 812 meint immer eine bestimmte Fassung.
 */
import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
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
/**
 * Stand der Verarbeitung im Zwischenspeicher (Phase 18). `NONE` heißt: noch
 * nicht angefangen – entweder ist die Datei noch nicht vollständig da, oder
 * es ist Kundenmaterial, das gar nicht verarbeitet wird.
 */
export const transcodeStatusEnum = pgEnum('transcode_status', [
  'NONE',
  'PROCESSING',
  'READY',
  'FAILED',
]);
/** Wohin ein Upload gehört: eine Videoversion oder der Kunden-Ordner eines Projekts. */
export const uploadKindEnum = pgEnum('upload_kind', ['VERSION', 'PROJECT_FILE']);
export const shareScopeEnum = pgEnum('share_scope', ['PROJECT', 'VIDEO']);
/** Wie das Material fürs Abspielen bereitsteht (siehe `transcode/media-plan.ts`). */
export const playbackModeEnum = pgEnum('playback_mode', ['ORIGINAL', 'REMUX', 'TRANSCODE']);
/** Stand einer Download-Fassung aus einem Format-Preset (Phase 19). */
export const renditionStatusEnum = pgEnum('rendition_status', [
  'QUEUED',
  'PROCESSING',
  'READY',
  'FAILED',
]);

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
    /**
     * Hat die Person ihren Namen selbst angegeben? (Phase 20)
     *
     * Ein frisch angelegtes Gastkonto trägt zunächst den Teil vor dem
     * At-Zeichen als Notbehelf – angezeigt werden muss ja etwas. Erst wenn
     * der Gast den Namen bestätigt hat, steht hier `true`, und danach wird
     * nie wieder gefragt.
     */
    nameConfirmed: boolean('name_confirmed').notNull().default(true),
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
    /**
     * KI-Kennzeichnung (Phase 24, Nachtrag). Anders als der Endfassungs-Haken
     * hängt sie am **Video**, nicht an einer Fassung: Ob KI-Stimme oder
     * KI-Musik im Schnitt stecken, ändert sich nicht von v2 auf v3. Welche
     * Arten es sind, steht in `video_ai_kinds`.
     */
    aiContent: boolean('ai_content').notNull().default(false),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [index('videos_project_idx').on(table.projectId, table.sortOrder)],
);

/**
 * Die Arten von KI-Inhalten, die der Workspace kennt (Phase 24, Nachtrag) –
 * ab Werk KI-Stimme, KI-Video, KI-Sounds und KI-Musik, vom Admin erweiterbar.
 * Grundlage für den Hinweis nach Art. 50 EU AI Act an gekennzeichneten Videos.
 */
export const aiContentKinds = pgTable(
  'ai_content_kinds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  // Zwei gleichnamige Arten wären in der Auswahl nicht zu unterscheiden.
  (table) => [uniqueIndex('ai_content_kinds_name_unique').on(sql`lower(${table.name})`)],
);

/** Welche KI-Arten an einem Video hängen – wie `project_tags` am Projekt. */
export const videoAiKinds = pgTable(
  'video_ai_kinds',
  {
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    kindId: uuid('kind_id')
      .notNull()
      .references(() => aiContentKinds.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.videoId, table.kindId] }),
    index('video_ai_kinds_kind_idx').on(table.kindId),
  ],
);

export const videoVersions = pgTable(
  'video_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    /** Fortlaufend ab 1, pro Video eindeutig. */
    // Nachkommastellen, damit zwischen v2 und v3 noch eine v2.5 passt. Drizzle
    // liefert `numeric` als Zeichenkette – die Umwandlung passiert in
    // `versions.service.ts`, damit die Rundung an einer Stelle steht.
    versionNumber: numeric('version_number', { precision: 8, scale: 3 }).notNull(),
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
    /**
     * Endfassung (Phase 17). Solange der Haken fehlt, warnt die Oberfläche
     * Gäste, dass sie eine Vorschau sehen, und der Downloadname trägt es mit.
     * Bewusst der Standard: Eine Fassung ist beim Hochladen erst einmal
     * Zwischenstand – final wird sie durch eine Entscheidung, nicht durch
     * Vergesslichkeit.
     */
    isFinal: boolean('is_final').notNull().default(false),

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

    /** Verzeichnis der HLS-Stufenleiter (Phase 13); `null`, wenn keine da ist. */
    hlsKey: text('hls_key'),
    /** Namen der Stufen, z. B. `2160p,1080p,720p` – für die Anzeige. */
    hlsVariants: text('hls_variants'),

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

    // ---------- Verarbeitung im Zwischenspeicher (Phase 18) ----------
    /**
     * Seit Phase 18 beginnt die Verarbeitung, sobald die Datei vollständig
     * übertragen ist – auch wenn noch kein Ziel feststeht. Sie läuft dann im
     * Zwischenspeicher, und erst beim Speichern wandert alles an seinen Platz.
     * Wer beim Hochladen erst überlegt, wartet danach nicht noch einmal.
     */
    transcodeStatus: transcodeStatusEnum('transcode_status').notNull().default('NONE'),
    transcodeProgress: integer('transcode_progress').notNull().default(0),
    transcodeError: text('transcode_error'),
    /**
     * Was dabei herauskam: Messwerte aus `ffprobe`, die Entscheidung über die
     * Abspielfassung und die Schlüssel der erzeugten Dateien. Beim Speichern
     * wird daraus die Fassung geschrieben – ohne ffmpeg ein zweites Mal
     * anzuwerfen. Als JSONB, weil es immer als Ganzes gelesen und geschrieben
     * wird und die Form nur den Weg vom Zwischenspeicher zur Fassung betrifft.
     */
    transcodeResult: jsonb('transcode_result'),

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
    /**
     * Einbetten auf fremden Seiten. Bewusst getrennt von allem anderen und
     * standardmäßig aus: Ein eingebetteter Player kommt ohne Code-Abfrage und
     * ohne Anmeldung aus – wer die Adresse hat, sieht das Video. Das ist eine
     * eigene Entscheidung und darf nicht als Nebenwirkung einer Freigabe
     * passieren.
     */
    /** @deprecated Seit Phase 23 ersetzt durch `isEmbed`; wird nicht mehr gelesen. */
    embedEnabled: boolean('embed_enabled').notNull().default(false),
    /**
     * Direktfreigabe (Phase 18): entsteht, wenn ein vorhandener Gast mit einem
     * Klick auf weitere Videos oder aufs ganze Projekt erweitert wird. Es gibt
     * eine Adresse dazu, aber niemand verschickt sie – deshalb blendet die
     * Oberfläche sie aus. Sonst ist es ein Link wie jeder andere: sichtbar in
     * der Liste, zurückziehbar wie alle.
     */
    isDirect: boolean('is_direct').notNull().default(false),
    /**
     * Einbett-Link (Phase 23): ein Link **nur** für den `iframe`, mit dem sich
     * niemand anmelden kann.
     *
     * Vorher war Einbetten ein Schalter am gewöhnlichen Freigabe-Link – und
     * damit trug derselbe Link zwei grundverschiedene Bedeutungen: einmal
     * „melde dich an und kommentiere", einmal „jeder, der die Adresse hat,
     * sieht das Video". Das war zu Recht als verwirrend gemeldet. Jetzt sind
     * es zwei Dinge: Einbett-Links tauchen in der Freigabenliste nicht auf,
     * und das Gast-Gatter weist sie ab.
     */
    isEmbed: boolean('is_embed').notNull().default(false),
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
    /**
     * Rechte-Ausnahmen für genau diese Person (Phase 16). `null` heißt „wie
     * der Link“; ein gesetzter Wert ersetzt das Link-Recht – in beide
     * Richtungen, geben wie nehmen.
     */
    allowDownload: boolean('allow_download'),
    allowUpload: boolean('allow_upload'),
    allowComments: boolean('allow_comments'),
    /**
     * „Externer Projektadmin" (Phase 21): Der Gast darf im Projekt Videos
     * anlegen, Fassungen hochladen und löschen, weiter freigeben und fremde
     * Kommentare verwalten – gedacht für Agenturen, die eigenes Material
     * einstellen. Anders als die drei Rechte oben kein „wie der Link", weil
     * ein Link selbst kein Projektadmin-Recht kennt: immer eine bewusste
     * Einzelentscheidung, deshalb nicht nullbar und ab Werk aus. Nur an einer
     * Projektfreigabe sinnvoll, nicht an einer einzelnen Videofreigabe.
     */
    projectAdmin: boolean('project_admin').notNull().default(false),
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

/**
 * Ordner im Kunden-Bereich eines Projekts (Phase 15).
 *
 * Eine schlichte Baumstruktur über `parentId`; `null` heißt Wurzelebene. Die
 * Kaskade auf sich selbst räumt beim Löschen eines Ordners den ganzen Ast ab –
 * die Dateien darin fallen über ihre eigene Kaskade mit.
 */
export const projectFolders = pgTable(
  'project_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'project_folders_parent_fk',
    }).onDelete('cascade'),
    index('project_folders_project_idx').on(table.projectId),
  ],
);

/** Datei im Kunden-Upload-Ordner eines Projekts (Phase 7). */
export const projectFiles = pgTable(
  'project_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Ordner im Kunden-Bereich; `null` heißt Wurzelebene (Phase 15). */
    folderId: uuid('folder_id').references(() => projectFolders.id, { onDelete: 'cascade' }),
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
 * Frei definierbare Schlagworte für Projekte (Phase 12).
 *
 * Bewusst workspace-weit und nicht pro Projekt: Der Sinn eines Tags ist ja
 * gerade, mehrere Projekte zusammenzufassen – etwa alle eines Kunden.
 */
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Hex-Farbe wie `#4c8dff`; ohne Angabe wird eine aus dem Namen abgeleitet. */
    color: text('color'),
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  // Zwei Tags mit gleichem Namen wären in der Filterleiste nicht zu
  // unterscheiden; verglichen wird ohne Rücksicht auf Groß- und Kleinschreibung.
  (table) => [uniqueIndex('tags_name_unique').on(sql`lower(${table.name})`)],
);

export const projectTags = pgTable(
  'project_tags',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.tagId] }),
    index('project_tags_tag_idx').on(table.tagId),
  ],
);

/**
 * Benutzerdefinierte Projekt-Felder (Phase 15): erst die Definitionen –
 * workspace-weit, in den Einstellungen gepflegt. Eine Projektnummer ist der
 * Anlassfall; deshalb schlichte Textfelder statt eines Typsystems.
 */
export const projectFieldDefs = pgTable(
  'project_field_defs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * Tippvorschläge aus den Werten der anderen Projekte (Phase 16)? Für einen
     * Kundennamen hilfreich, für eine einmalige Projektnummer sinnlos – darum
     * je Feld schaltbar und vorsichtshalber aus.
     */
    suggest: boolean('suggest').notNull().default(false),
    /**
     * Steht das Feld in der Filter-, Sortier- bzw. Gruppier-Auswahl der
     * Projektliste (Phase 22)? Ab Werk an – das war bis dahin das Verhalten
     * für jedes Feld, und ein Feld, nach dem niemand filtern oder sortieren
     * will, schaltet man gezielt ab.
     */
    filterable: boolean('filterable').notNull().default(true),
    sortable: boolean('sortable').notNull().default(true),
    groupable: boolean('groupable').notNull().default(true),
    /**
     * Wert auf der Projektkachel anzeigen (Phase 22)? Ab Werk aus – die Kachel
     * ist klein, und bis dahin stand dort auch nichts davon.
     */
    showOnTile: boolean('show_on_tile').notNull().default(false),
    ...timestamps,
  },
  // Zwei Felder mit gleichem Namen wären im Formular nicht zu unterscheiden.
  (table) => [uniqueIndex('project_field_defs_name_unique').on(sql`lower(${table.name})`)],
);

/** … und die Werte je Projekt. Kein Eintrag heißt: Feld ist dort leer. */
export const projectFieldValues = pgTable(
  'project_field_values',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => projectFieldDefs.id, { onDelete: 'cascade' }),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.fieldId] })],
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
  /**
   * Authentifizierung beim Versand: `password` (Benutzername und Kennwort)
   * oder `oauth2` (Client-Credentials-Fluss gegen Entra ID). Microsoft 365
   * lehnt SMTP AUTH mit Kennwort ab, sobald der Tenant Mehrfaktor-Anmeldung
   * erzwingt – dann bleibt nur OAuth2.
   */
  smtpAuthMethod: text('smtp_auth_method').notNull().default('password'),
  /** Nur bei `oauth2`: Tenant- und Anwendungs-ID der App-Registrierung. */
  smtpOauthTenantId: text('smtp_oauth_tenant_id'),
  smtpOauthClientId: text('smtp_oauth_client_id'),
  /** Verschlüsselt abgelegt, siehe `common/secret-box.ts`. */
  smtpOauthClientSecretEncrypted: text('smtp_oauth_client_secret_encrypted'),
  smtpFromName: text('smtp_from_name'),
  smtpFromEmail: text('smtp_from_email'),

  // ---------- White-Label (Phase 10) ----------
  /** Titel im Kopf, im Browser-Tab und in jeder E-Mail. */
  brandTitle: text('brand_title'),
  /** Eine Farbe; heller Hover-Ton und lesbare Schriftfarbe leiten sich ab. */
  brandAccent: text('brand_accent'),
  brandLogoKey: text('brand_logo_key'),
  brandLogoMime: text('brand_logo_mime'),
  /** Wechselt bei jedem neuen Logo und bricht damit den Browser-Cache auf. */
  brandLogoUpdatedAt: timestamp('brand_logo_updated_at', { withTimezone: true }),

  /**
   * Das hochgeladene Tab-Symbol als `.ico` (Phase 23, vereinfacht in 24).
   *
   * Bis Phase 24 stand hier zusätzlich ein Modus: Standard-Zeichen, Logo oder
   * eigene Datei – und im Fall „Logo" rechnete die Oberfläche das Symbol selbst
   * aus. Das Ergebnis passte selten; ein Symbol, das im 16-Pixel-Tab bestehen
   * soll, entsteht nicht durch Verkleinern. Jetzt wird eine fertige Datei
   * hochgeladen oder eben keine.
   */
  faviconKey: text('favicon_key'),
  faviconMime: text('favicon_mime'),
  faviconUpdatedAt: timestamp('favicon_updated_at', { withTimezone: true }),

  /**
   * Das hochgeladene App-Symbol als quadratisches PNG (Phase 24) – für den
   * iOS-Startbildschirm und das Web-App-Manifest. Ein SVG wird dort gar nicht
   * angenommen, deshalb ein eigenes Feld neben dem Logo.
   */
  appIconKey: text('app_icon_key'),
  /** Wechselt bei jedem neuen Symbol und bricht damit den Browser-Cache auf. */
  appIconUpdatedAt: timestamp('app_icon_updated_at', { withTimezone: true }),

  /**
   * Datenbanksicherung (Phase 23). Ab Werk aus – eine Sicherung, die niemand
   * bestellt hat, schreibt sonst still Dateien auf ein Volume, dessen Größe
   * der Betreiber selbst kalkuliert hat.
   */
  backupEnabled: boolean('backup_enabled').notNull().default(false),
  backupIntervalHours: integer('backup_interval_hours').notNull().default(24),
  backupRetentionDays: integer('backup_retention_days').notNull().default(30),
  /** Wann zuletzt gesichert wurde – Grundlage für den nächsten Termin. */
  backupLastRunAt: timestamp('backup_last_run_at', { withTimezone: true }),
  /** Die Meldung des letzten gescheiterten Laufs, im Klartext. */
  backupLastError: text('backup_last_error'),

  /**
   * Das Haus, dem der Workspace gehört (Phase 20). Das Kürzel steht in
   * Klammern hinter jedem Namen aus dem eigenen Team – in einem Projekt
   * sitzen Leute aus zwei Häusern, und an einem Kommentar stand bisher nur
   * ein Name.
   */
  companyName: text('company_name'),
  companyShort: text('company_short'),

  /**
   * Freitext für die Seite „Über diese Software": Auf welcher Umgebung
   * dieser Stack läuft (etwa „läuft auf nativer Hardware, kein NAS"). Steht
   * neben den festen Angaben zum Autor, weil nur der Admin vor Ort weiß, wo
   * der Container tatsächlich steht – das kann Klappe selbst nicht wissen.
   */
  environmentNotes: text('environment_notes'),

  // ---------- Anmeldung (Phase 11) ----------
  /** Lokale Konten mit Passwort. Abschaltbar, sobald M365 nachweislich läuft. */
  localLoginEnabled: boolean('local_login_enabled').notNull().default(true),
  oidcEnabled: boolean('oidc_enabled').notNull().default(false),
  /** Tenant-Kennung oder Domäne, z. B. `contoso.onmicrosoft.com`. */
  oidcTenantId: text('oidc_tenant_id'),
  oidcClientId: text('oidc_client_id'),
  /** Verschlüsselt abgelegt, siehe `common/secret-box.ts`. */
  oidcClientSecretEncrypted: text('oidc_client_secret_encrypted'),
  /** Legt eine unbekannte, aber zugelassene Adresse ein Team-Konto an? */
  oidcAutoProvision: boolean('oidc_auto_provision').notNull().default(false),
  /** Kommaliste erlaubter Mail-Domänen; leer heißt: keine Einschränkung. */
  oidcAllowedDomains: text('oidc_allowed_domains'),
  /** Beschriftung der Schaltfläche auf der Anmeldeseite. */
  oidcButtonLabel: text('oidc_button_label'),

  /**
   * Externer API-Zugriff (Phase 25). Ab Werk **aus**: Wer Klappe nur im
   * Browser benutzt, soll keine zweite Tür offen haben, von der er nichts
   * weiß. Aus heißt, dass `Authorization: Bearer …` gar nicht erst geprüft
   * wird – weder ein API-Token noch ein Sitzungs-JWT im Header. Die Anmeldung
   * im Browser läuft über das Sitzungs-Cookie und bleibt davon unberührt.
   */
  apiAccessEnabled: boolean('api_access_enabled').notNull().default(false),

  /**
   * Passwort-Richtlinie für Team-Konten (Phase 24). Vorher standen diese
   * Regeln fest im Code; die Vorgabewerte hier sind genau die alten, damit ein
   * Update kein bestehendes Passwort ungültig macht. Gäste betrifft das nicht –
   * sie melden sich per Code an und haben gar kein Passwort.
   */
  passwordMinLength: integer('password_min_length').notNull().default(10),
  passwordRequireLetter: boolean('password_require_letter').notNull().default(true),
  passwordRequireDigit: boolean('password_require_digit').notNull().default(true),
  passwordRequireMixedCase: boolean('password_require_mixed_case').notNull().default(false),
  passwordRequireSymbol: boolean('password_require_symbol').notNull().default(false),

  // ---------- Projektliste (Phase 16) ----------
  /**
   * Schlagworte im Workspace verwenden? Wer nur mit den benutzerdefinierten
   * Feldern arbeitet, blendet sie damit überall aus – Filter, Kacheln,
   * Projektseite. Die Daten bleiben erhalten.
   */
  tagsEnabled: boolean('tags_enabled').notNull().default(true),

  /**
   * KI-Kennzeichnung im Workspace verwenden (Phase 24, Nachtrag)? Aus heißt:
   * Haken, Auswahl und Hinweis verschwinden überall; gesetzte Kennzeichnungen
   * bleiben gespeichert und kommen beim Wiedereinschalten zurück – wie bei
   * den Schlagworten.
   */
  aiContentEnabled: boolean('ai_content_enabled').notNull().default(true),

  // ---------- Benachrichtigungen (Phase 18) ----------
  /**
   * Ruhezeit vor dem Versand: Erst wenn so viele Minuten lang kein neuer
   * Kommentar mehr kam, geht eine Sammelmail raus. `0` schaltet das Bündeln
   * ab und schickt wie früher sofort.
   */
  mailDigestMinutes: integer('mail_digest_minutes').notNull().default(5),

  /**
   * Wie lange die alten Fassungen eines archivierten Projekts noch liegen
   * bleiben (Phase 18). Danach räumt der tägliche Aufräumer sie weg – die
   * neueste bleibt immer. 30 Tage sind der Standard: lang genug, um einen
   * Irrtum zu bemerken, kurz genug, um Platz zu schaffen.
   */
  archiveRetentionDays: integer('archive_retention_days').notNull().default(30),

  // ---------- Verarbeitung (Phase 19) ----------
  /**
   * Bietet das Download-Fenster neben dem Original auch fertige Formate an?
   * Aus heißt: Der Knopf lädt wie bisher direkt das Original.
   */
  downloadFormatsEnabled: boolean('download_formats_enabled').notNull().default(false),
  /** Vorab nur für Endfassungen erzeugen, nicht für jeden Zwischenstand. */
  downloadFinalOnly: boolean('download_final_only').notNull().default(false),
  /**
   * Wann die Formate entstehen (Phase 20): `on-demand` beim ersten Klick,
   * `upload` gleich nach dem Hochladen, `schedule` erst im Zeitfenster.
   * Löst den früheren Haken „direkt beim Upload erstellen" ab, der sich mit
   * dem Zeitfenster daneben widersprechen konnte.
   */
  downloadTiming: text('download_timing').notNull().default('on-demand'),

  /**
   * Zeitfenster für die Formate, in Minuten seit Mitternacht (Ortszeit des
   * Containers). Ein Start hinter dem Ende meint die Nacht – 1320/360 ist
   * 22:00 bis 6:00. Nur von Belang, wenn `downloadTiming` auf `schedule`
   * steht.
   */
  downloadWindowStart: smallint('download_window_start'),
  downloadWindowEnd: smallint('download_window_end'),

  /**
   * Die HLS-Stufenleiter hat seit Phase 20 ihren eigenen Zeitplan – sie ist
   * eine andere Sorte Arbeit als ein Download-Format und soll nicht an
   * dessen Einstellung hängen. `null` heißt wie unten: nie in der Oberfläche
   * entschieden, es gilt `HLS_ENABLED` aus der `.env`.
   */
  hlsMode: text('hls_mode'),
  hlsWindowStart: smallint('hls_window_start'),
  hlsWindowEnd: smallint('hls_window_end'),

  /**
   * Die folgenden Werte sind absichtlich nullbar: `null` heißt „in der
   * Oberfläche nie entschieden – nimm, was in der `.env` steht". So läuft
   * eine bestehende Anlage unverändert weiter, und der erste Klick übernimmt
   * die Hoheit.
   */
  proxyShortEdge: integer('proxy_short_edge'),
  proxyVideoBitrateKbps: integer('proxy_video_bitrate_kbps'),
  proxyPreset: text('proxy_preset'),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Die Formate, die beim Herunterladen zur Auswahl stehen (Phase 19).
 *
 * Angelegt werden sie nur vom Admin. Wer herunterlädt, sieht nur den Namen
 * und die Größe – nicht Bitrate und Preset.
 */
export const downloadPresets = pgTable(
  'download_presets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Kurze Kante, wie überall: 1080 ist quer 1920×1080 und hoch 1080×1920. */
    shortEdge: integer('short_edge').notNull(),
    videoBitrateKbps: integer('video_bitrate_kbps').notNull(),
    audioBitrateKbps: integer('audio_bitrate_kbps').notNull().default(192),
    /** x264-Preset (`ultrafast` … `veryslow`). */
    preset: text('preset').notNull().default('veryfast'),
    container: text('container').notNull().default('mp4'),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Ausschalten statt löschen – erzeugte Dateien bleiben, die Auswahl geht weg. */
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('download_presets_name_idx').on(sql`lower(${table.name})`),
    index('download_presets_order_idx').on(table.sortOrder, table.createdAt),
  ],
);

/**
 * Eine erzeugte Download-Fassung: ein Preset, angewendet auf eine Version.
 *
 * `signature` hält fest, mit welchen Werten die Datei entstanden ist. Ändert
 * der Admin das Preset später, passt die Unterschrift nicht mehr und die
 * Fassung wird neu erzeugt – statt still eine Datei auszuliefern, die mit dem
 * gewählten Format nichts mehr zu tun hat.
 */
export const versionRenditions = pgTable(
  'version_renditions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => videoVersions.id, { onDelete: 'cascade' }),
    presetId: uuid('preset_id')
      .notNull()
      .references(() => downloadPresets.id, { onDelete: 'cascade' }),
    status: renditionStatusEnum('status').notNull().default('QUEUED'),
    progress: smallint('progress').notNull().default(0),
    error: text('error'),
    signature: text('signature').notNull(),
    storageKey: text('storage_key'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    width: integer('width'),
    height: integer('height'),
    /** Wer sie angefordert hat – `null` bei der Vorab-Erzeugung. */
    requestedById: uuid('requested_by_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('version_renditions_version_preset_idx').on(table.versionId, table.presetId),
    index('version_renditions_status_idx').on(table.status),
  ],
);

/**
 * Wer will über einen Film Bescheid wissen? (Phase 18)
 *
 * Vorher entschied das der Zufall: Wer eine Fassung hochgeladen oder einmal
 * kommentiert hatte, bekam fortan Mails. Jetzt trägt man es ein – entweder
 * fürs ganze Projekt oder für ein einzelnes Video. Bewusst **nicht** je
 * Fassung: Eine neue Version ist derselbe Film, nicht ein neuer.
 *
 * Genau eine der beiden Spalten ist gesetzt. Zwei Unique-Indizes reichen zum
 * Absichern, weil Postgres `NULL` als verschieden ansieht: Eine Projektzeile
 * kollidiert nie mit einer Videozeile.
 */
export const notificationSubscriptions = pgTable(
  'notification_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    videoId: uuid('video_id').references(() => videos.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_subscriptions_user_project_idx').on(table.userId, table.projectId),
    uniqueIndex('notification_subscriptions_user_video_idx').on(table.userId, table.videoId),
    index('notification_subscriptions_project_idx').on(table.projectId),
    index('notification_subscriptions_video_idx').on(table.videoId),
  ],
);

/**
 * Die Benachrichtigungszentrale (Phase 18).
 *
 * Hier bleibt stehen, was jemanden betrifft – ob eine Mail rausging oder
 * nicht. Absichtlich getrennt von `pending_notifications`: Das ist eine
 * Warteschlange, die sich mit dem Versand leert; das hier ist die Ablage, in
 * der man nachsieht, was man verpasst hat.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    /** Namentlich erwähnt – in der Liste hervorgehoben. */
    mentioned: boolean('mentioned').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notifications_user_comment_idx').on(table.userId, table.commentId),
    // Die Abfrage der Zentrale: eigene Einträge, neueste zuerst.
    index('notifications_user_created_idx').on(table.userId, table.createdAt),
  ],
);

/**
 * Mails, die nicht zugestellt werden konnten (Phase 18).
 *
 * Bisher stand ein gescheiterter Versand nur im Log – wer keins liest, erfuhr
 * nie, dass der Kunde die Einladung gar nicht bekommen hat. Jetzt steht es in
 * den Einstellungen.
 *
 * Eine Zeile je Empfänger und Betreff: Die Warteschlange versucht es mehrfach,
 * und vier gleiche Zeilen sind kein besserer Hinweis als eine mit „4
 * Versuche“.
 */
export const mailFailures = pgTable(
  'mail_failures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    /** Die Meldung des Mailservers, gekürzt. */
    error: text('error').notNull(),
    attempts: integer('attempts').notNull().default(1),
    firstAt: timestamp('first_at', { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('mail_failures_recipient_subject_idx').on(table.recipient, table.subject),
    index('mail_failures_last_idx').on(table.lastAt),
  ],
);

/**
 * Wartende Benachrichtigungen (Phase 18).
 *
 * Ein Kommentar landet hier je Empfänger, statt sofort eine Mail auszulösen.
 * Der Worker schaut nach der Ruhezeit noch einmal her und macht aus allem,
 * was zu einem Empfänger und einem Video wartet, genau eine Mail. Die Zeile
 * verschwindet mit dem Versand – und mit dem Kommentar, falls der vorher
 * gelöscht wird.
 */
export const pendingNotifications = pgTable(
  'pending_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    /** Sammelpunkt: eine Mail je Video, nicht je Fassung. */
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    /** Wurde der Empfänger namentlich erwähnt? Steht dann auch im Betreff. */
    mentioned: boolean('mentioned').notNull().default(false),
    /**
     * Gesetzt, sobald ein Job diese Zeile für seine Mail beansprucht hat.
     * Verhindert, dass zwei gleichzeitig fällige Jobs dieselbe Sammlung
     * verschicken. Bleibt eine Beanspruchung liegen (Absturz mitten im
     * Versand), gibt sie eine Viertelstunde später wieder frei.
     */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Derselbe Kommentar darf nicht zweimal für dieselbe Person warten –
    // sonst stünde er nach einem wiederholten Job doppelt in der Mail.
    uniqueIndex('pending_notifications_user_comment_idx').on(table.userId, table.commentId),
    index('pending_notifications_user_video_idx').on(table.userId, table.videoId),
  ],
);

/**
 * API-Tokens für externe Anbindungen (Phase 25).
 *
 * Ein Token gehört immer zu **einem** Konto und trägt genau dessen Rechte –
 * ein Plugin sieht also das, was die Person auch im Browser sähe, nicht mehr.
 * Das ist der Grund, warum es keinen workspace-weiten Generalschlüssel gibt:
 * An jedem Kommentar, jedem Upload und jeder Freigabe hängt sonst dieselbe
 * namenlose Kennung.
 *
 * Gespeichert wird nie der Token selbst, sondern nur `selector` (offen, zum
 * Nachschlagen) und `secretHash` – siehe `api-token.ts`.
 */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Was in der Liste steht, etwa „DaVinci Resolve auf dem Schnittrechner“. */
    name: text('name').notNull(),
    selector: text('selector').notNull(),
    secretHash: text('secret_hash').notNull(),
    /**
     * Wie der Token entstanden ist: `device` über die Gerätekopplung im
     * Browser, `manual` von Hand in den Einstellungen. Nur zur Anzeige – für
     * die Rechte macht es keinen Unterschied.
     */
    origin: text('origin').notNull().default('device'),
    /**
     * Fortgeschrieben bei Benutzung, aber höchstens einmal pro Minute: Der
     * Wert soll die Frage „wird das noch benutzt?“ beantworten, und dafür
     * lohnt kein Schreibvorgang je Anfrage.
     */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /** Gesetzt heißt widerrufen. Die Zeile bleibt, damit die Liste ehrlich ist. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('api_tokens_selector_unique').on(table.selector),
    index('api_tokens_user_idx').on(table.userId, table.createdAt),
  ],
);

/**
 * Wartende Gerätekopplungen (Phase 25).
 *
 * Der Ablauf, den ein Plugin durchläuft: Es meldet sich an dieser Stelle an,
 * zeigt den kurzen Benutzercode auf dem Schirm, und ein angemeldeter Mensch
 * bestätigt ihn im Browser. Erst danach entsteht der Token.
 *
 * Der fertige Token liegt bis zur Abholung **verschlüsselt** hier (dieselbe
 * Kiste wie die SMTP-Geheimnisse) und wird beim Abholen gelöscht. Anders
 * ginge es nicht: Das Plugin ist im Moment der Bestätigung nicht am Zug, und
 * ein zweites Mal lässt sich der Klartext nirgends herholen.
 */
export const deviceAuthorizations = pgTable(
  'device_authorizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Nur der Hash – der lange Code bleibt beim Plugin. */
    deviceCodeHash: text('device_code_hash').notNull(),
    /** Der kurze Code zum Abtippen, `KHFP-3RTM`. */
    userCode: text('user_code').notNull(),
    /** Wie sich das Plugin nennt; wird zum Namen des Tokens. */
    clientName: text('client_name').notNull(),
    /** Wer bestätigt hat. Offen, solange niemand bestätigt hat. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    /** Abgelehnt – das Plugin bekommt eine klare Absage statt eines Zeitablaufs. */
    deniedAt: timestamp('denied_at', { withTimezone: true }),
    apiTokenId: uuid('api_token_id').references(() => apiTokens.id, { onDelete: 'cascade' }),
    /** Der Klartext-Token bis zur Abholung, verschlüsselt (`common/secret-box.ts`). */
    tokenEncrypted: text('token_encrypted'),
    /** Fehlversuche beim Abholen – bremst das Durchprobieren von Gerätecodes. */
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('device_authorizations_device_code_unique').on(table.deviceCodeHash),
    // Nicht eindeutig: Ein abgelaufener Code darf später wieder vorkommen.
    // Gesucht wird immer zusammen mit „noch gültig“, siehe den Dienst.
    index('device_authorizations_user_code_idx').on(table.userCode, table.expiresAt),
    index('device_authorizations_expires_idx').on(table.expiresAt),
  ],
);

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
export type TagRow = typeof tags.$inferSelect;
export type AiContentKindRow = typeof aiContentKinds.$inferSelect;
export type ProjectFieldDefRow = typeof projectFieldDefs.$inferSelect;
export type ProjectFolderRow = typeof projectFolders.$inferSelect;
export type PendingNotificationRow = typeof pendingNotifications.$inferSelect;
export type NotificationSubscriptionRow = typeof notificationSubscriptions.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type MailFailureRow = typeof mailFailures.$inferSelect;
export type DownloadPresetRow = typeof downloadPresets.$inferSelect;
export type VersionRenditionRow = typeof versionRenditions.$inferSelect;
export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type DeviceAuthorizationRow = typeof deviceAuthorizations.$inferSelect;
