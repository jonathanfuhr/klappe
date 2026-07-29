-- Verarbeitung parallel zur Eingabe (Phase 18).
--
-- Bisher begann die Verarbeitung erst, wenn Projekt, Video und Fassung
-- feststanden – wer beim Hochladen erst ueberlegte, wartete danach noch einmal
-- die volle Transcode-Zeit. Jetzt laeuft sie los, sobald die Datei vollstaendig
-- uebertragen ist, und zwar im Zwischenspeicher. Erst beim Speichern wandert
-- alles an seinen Platz; ist die Verarbeitung dann noch nicht fertig, uebernimmt
-- sie den Umzug selbst, sobald sie durch ist.
--
-- Das Ergebnis liegt solange an der Upload-Sitzung: Messwerte, Entscheidung
-- ueber die Abspielfassung und die Schluessel der erzeugten Dateien. Beim
-- Speichern wird daraus die Fassung geschrieben, ohne ffmpeg ein zweites Mal
-- anzuwerfen.
CREATE TYPE "public"."transcode_status" AS ENUM('NONE', 'PROCESSING', 'READY', 'FAILED');--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "transcode_status" "transcode_status" DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "transcode_progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "transcode_error" text;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "transcode_result" jsonb;
