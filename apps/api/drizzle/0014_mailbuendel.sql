-- Sammelmails statt Einzelmails (Phase 18).
--
-- Bisher löste jeder Kommentar sofort eine Mail aus: Fünfzehn Anmerkungen des
-- Kunden wurden zu fünfzehn Mails. Jetzt wartet eine Benachrichtigung, bis
-- eine Weile Ruhe war, und geht dann gesammelt raus – eine Mail je Empfänger
-- und Video. `0` schaltet das Bündeln ab und verhält sich wie vorher.
ALTER TABLE "app_settings" ADD COLUMN "mail_digest_minutes" integer DEFAULT 5 NOT NULL;

CREATE TABLE "pending_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"video_id" uuid NOT NULL,
	"mentioned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_notifications" ADD CONSTRAINT "pending_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Wird der Kommentar gelöscht, bevor die Mail rausging, erübrigt sich der Hinweis.
ALTER TABLE "pending_notifications" ADD CONSTRAINT "pending_notifications_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_notifications" ADD CONSTRAINT "pending_notifications_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_notifications_user_comment_idx" ON "pending_notifications" USING btree ("user_id","comment_id");--> statement-breakpoint
CREATE INDEX "pending_notifications_user_video_idx" ON "pending_notifications" USING btree ("user_id","video_id");
