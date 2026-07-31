ALTER TABLE "app_settings" ADD COLUMN "app_icon_key" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "app_icon_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "password_min_length" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "password_require_letter" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "password_require_digit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "password_require_mixed_case" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "password_require_symbol" boolean DEFAULT false NOT NULL;