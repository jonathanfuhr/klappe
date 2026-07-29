-- Transcode-Einstellungen und Download-Formate (Phase 19).
--
-- Bisher stand alles, was die Verarbeitung betrifft, in der `.env`: ob eine
-- HLS-Leiter entsteht, wie groß der Proxy wird, mit welchem Preset kodiert
-- wird. Wer daran etwas ändern wollte, musste an den Container. Ab hier steht
-- es in der Datenbank und damit in der Oberflaeche.
--
-- Die neuen Spalten sind bewusst *nullable*, wo es schon einen Wert in der
-- `.env` gibt: `NULL` heißt „nicht in der Oberflaeche entschieden – nimm, was
-- im Container steht". Damit laeuft eine bestehende Anlage unveraendert
-- weiter, und der erste Klick in der Oberflaeche uebernimmt die Hoheit.
ALTER TABLE "app_settings" ADD COLUMN "download_formats_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "download_prebuild" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "download_final_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Zeitfenster fuer die aufwendige Nacharbeit, in Minuten seit Mitternacht
-- (Ortszeit des Containers). Beide Spalten `NULL` heißt: kein Fenster, es
-- laeuft sofort. Start groesser als Ende ist erlaubt und meint die Nacht:
-- 1320/360 ist 22:00 bis 6:00.
ALTER TABLE "app_settings" ADD COLUMN "transcode_window_start" smallint;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "transcode_window_end" smallint;--> statement-breakpoint

-- `NULL` = wie in der `.env` (HLS_ENABLED). Sobald jemand den Schalter
-- umlegt, gilt die Datenbank.
ALTER TABLE "app_settings" ADD COLUMN "hls_enabled" boolean;--> statement-breakpoint

-- Ebenso die Werte der Abspielfassung: `NULL` = PROXY_SHORT_EDGE,
-- PROXY_VIDEO_BITRATE und PROXY_PRESET aus dem Container.
ALTER TABLE "app_settings" ADD COLUMN "proxy_short_edge" integer;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "proxy_video_bitrate_kbps" integer;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "proxy_preset" text;--> statement-breakpoint

-- Die Formate, die beim Herunterladen zur Auswahl stehen. Angelegt werden sie
-- nur vom Admin; der Kunde sieht im Download-Fenster ausschließlich das
-- Ergebnis.
CREATE TABLE "download_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	-- Kurze Kante, wie ueberall im Projekt: 1080 heißt quer 1920x1080 und
	-- hoch 1080x1920. Vergroeßert wird nie.
	"short_edge" integer NOT NULL,
	"video_bitrate_kbps" integer NOT NULL,
	"audio_bitrate_kbps" integer DEFAULT 192 NOT NULL,
	-- x264-Preset: ultrafast … veryslow. Langsamer heißt kleiner bei gleicher
	-- Qualitaet, kostet aber Rechenzeit.
	"preset" text DEFAULT 'veryfast' NOT NULL,
	"container" text DEFAULT 'mp4' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	-- Ausschalten statt loeschen: Die schon erzeugten Dateien bleiben liegen,
	-- die Auswahl wird nur nicht mehr angeboten.
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "download_presets_name_idx" ON "download_presets" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "download_presets_order_idx" ON "download_presets" USING btree ("sort_order","created_at");--> statement-breakpoint

CREATE TYPE "public"."rendition_status" AS ENUM('QUEUED', 'PROCESSING', 'READY', 'FAILED');--> statement-breakpoint

-- Eine erzeugte Download-Fassung: ein Preset, angewendet auf eine Version.
--
-- `signature` haelt fest, mit welchen Werten die Datei entstanden ist. Aendert
-- der Admin das Preset spaeter, passt die Unterschrift nicht mehr und die
-- Fassung wird bei der naechsten Anfrage neu erzeugt – statt still eine Datei
-- auszuliefern, die mit dem gewaehlten Format nichts mehr zu tun hat.
CREATE TABLE "version_renditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"preset_id" uuid NOT NULL,
	"status" "rendition_status" DEFAULT 'QUEUED' NOT NULL,
	"progress" smallint DEFAULT 0 NOT NULL,
	"error" text,
	"signature" text NOT NULL,
	"storage_key" text,
	"size_bytes" bigint,
	"width" integer,
	"height" integer,
	"requested_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "version_renditions" ADD CONSTRAINT "version_renditions_version_id_video_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."video_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_renditions" ADD CONSTRAINT "version_renditions_preset_id_download_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."download_presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "version_renditions" ADD CONSTRAINT "version_renditions_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "version_renditions_version_preset_idx" ON "version_renditions" USING btree ("version_id","preset_id");--> statement-breakpoint
CREATE INDEX "version_renditions_status_idx" ON "version_renditions" USING btree ("status");--> statement-breakpoint

-- Drei Voreinstellungen, damit der Schalter „Download in verschiedenen
-- Formaten" nicht in eine leere Liste fuehrt. Die Funktion selbst bleibt aus,
-- bis jemand sie einschaltet – hier entsteht also noch keine einzige Datei.
INSERT INTO "download_presets" ("name", "short_edge", "video_bitrate_kbps", "preset", "sort_order")
VALUES
	('1080p – Web', 1080, 10000, 'veryfast', 10),
	('720p – Vorschau', 720, 5000, 'veryfast', 20),
	('540p – klein', 540, 2500, 'veryfast', 30);
