ALTER TABLE "app_settings" ADD COLUMN "app_icon_key" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "app_icon_updated_at" timestamp with time zone;
