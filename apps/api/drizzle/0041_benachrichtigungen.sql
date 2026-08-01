CREATE TABLE "notification_settings" (
	"kind" text PRIMARY KEY NOT NULL,
	"team_enabled" boolean DEFAULT true NOT NULL,
	"guest_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "mail_project_file_digest_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "mail_mention_immediate" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "internal_versions_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "internal_versions_default" boolean DEFAULT true NOT NULL;