ALTER TABLE "app_settings" ADD COLUMN "default_locale" text DEFAULT 'de' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" text;