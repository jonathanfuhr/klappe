-- Phase 20: Die Verarbeitungseinstellungen bekommen je einen eigenen,
-- verständlichen Zeitplan.
--
-- Vorher: ein Haken "direkt beim Upload erstellen" und daneben ein
-- Zeitfenster, das für Download-Formate und HLS-Leiter zugleich galt. Beides
-- ließ sich widersprüchlich kombinieren, und welcher Schalter woran hing,
-- stand nirgends. Jetzt: je eine Auswahl aus sich ausschließenden
-- Möglichkeiten, jede mit eigenen Uhrzeiten.
ALTER TABLE "app_settings" ADD COLUMN "download_timing" text DEFAULT 'on-demand' NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "download_window_start" smallint;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "download_window_end" smallint;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "hls_mode" text;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "hls_window_start" smallint;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "hls_window_end" smallint;
--> statement-breakpoint

-- Das bisherige Verhalten wird übernommen, nicht zurückgesetzt: Wer die
-- Vorab-Erzeugung anhatte, behält sie – mit Zeitfenster als "schedule", ohne
-- als "upload".
UPDATE "app_settings" SET
  "download_timing" = CASE
    WHEN "download_prebuild" IS NOT TRUE THEN 'on-demand'
    WHEN "transcode_window_start" IS NOT NULL AND "transcode_window_end" IS NOT NULL THEN 'schedule'
    ELSE 'upload'
  END,
  "download_window_start" = "transcode_window_start",
  "download_window_end" = "transcode_window_end",
  -- NULL bleibt NULL: "in der Oberflaeche nie entschieden, nimm HLS_ENABLED".
  "hls_mode" = CASE
    WHEN "hls_enabled" IS NULL THEN NULL
    WHEN "hls_enabled" IS FALSE THEN 'off'
    WHEN "transcode_window_start" IS NOT NULL AND "transcode_window_end" IS NOT NULL THEN 'schedule'
    ELSE 'upload'
  END,
  "hls_window_start" = "transcode_window_start",
  "hls_window_end" = "transcode_window_end";
--> statement-breakpoint

ALTER TABLE "app_settings" DROP COLUMN "download_prebuild";
--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN "transcode_window_start";
--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN "transcode_window_end";
--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN "hls_enabled";
