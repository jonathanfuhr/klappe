-- Wer bekommt Post? (Phase 18)
--
-- Bisher entschied das der Zufall: Wer eine Fassung hochgeladen oder einmal
-- kommentiert hatte, bekam fortan Mails zu diesem Film. Jetzt steht es in der
-- Spalte „Benachrichtigungen“ am Projekt und am Video. Nicht je Fassung – eine
-- neue Version ist derselbe Film.
--
-- Genau eine der beiden Spalten ist gesetzt; die Prüfung steht als CHECK dabei,
-- damit keine halbe Zeile entsteht. Die Unique-Indizes genügen, weil Postgres
-- `NULL` als verschieden ansieht: Eine Projektzeile kollidiert nie mit einer
-- Videozeile.
CREATE TABLE "notification_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"video_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_subscriptions_ziel_check" CHECK (num_nonnulls("project_id", "video_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_subscriptions_user_project_idx" ON "notification_subscriptions" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_subscriptions_user_video_idx" ON "notification_subscriptions" USING btree ("user_id","video_id");--> statement-breakpoint
CREATE INDEX "notification_subscriptions_project_idx" ON "notification_subscriptions" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "notification_subscriptions_video_idx" ON "notification_subscriptions" USING btree ("video_id");--> statement-breakpoint

-- Bestandsdaten übernehmen: Wer eine Fassung hochgeladen hat, war bisher
-- faktisch für das Video zuständig und soll es bleiben. Sonst würden mit
-- dieser Migration schlagartig alle Benachrichtigungen verstummen.
INSERT INTO "notification_subscriptions" ("user_id", "video_id")
SELECT DISTINCT v."uploaded_by_id", v."video_id"
FROM "video_versions" v
JOIN "users" u ON u."id" = v."uploaded_by_id"
WHERE v."uploaded_by_id" IS NOT NULL AND u."role" IN ('ADMIN', 'MEMBER')
ON CONFLICT DO NOTHING;
