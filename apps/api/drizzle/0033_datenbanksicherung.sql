ALTER TABLE "app_settings" ADD COLUMN "backup_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "backup_interval_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "backup_retention_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "backup_last_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "backup_last_error" text;