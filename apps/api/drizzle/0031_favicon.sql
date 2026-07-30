ALTER TABLE "app_settings" ADD COLUMN "favicon_mode" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "favicon_key" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "favicon_mime" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "favicon_updated_at" timestamp with time zone;