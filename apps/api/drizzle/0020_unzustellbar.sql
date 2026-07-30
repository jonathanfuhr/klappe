-- Unzustellbare Mails sichtbar machen (Phase 18, Zusatz).
--
-- Bisher stand ein gescheiterter Versand nur im Log – wer keins liest, erfuhr
-- nie, dass der Kunde die Einladung gar nicht bekommen hat. Jetzt steht es in
-- den Einstellungen, neben dem Mailserver, der es nicht geschafft hat.
--
-- Eine Zeile je Empfaenger und Betreff: Die Warteschlange versucht es
-- mehrfach, und vier gleiche Zeilen sind kein besserer Hinweis als eine mit
-- „4 Versuche".
CREATE TABLE "mail_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"error" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mail_failures_recipient_subject_idx" ON "mail_failures" USING btree ("recipient","subject");--> statement-breakpoint
CREATE INDEX "mail_failures_last_idx" ON "mail_failures" USING btree ("last_at");
