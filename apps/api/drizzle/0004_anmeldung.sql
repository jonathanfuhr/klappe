ALTER TABLE "app_settings" ADD COLUMN "local_login_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "oidc_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "oidc_tenant_id" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "oidc_client_id" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "oidc_client_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "oidc_auto_provision" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "oidc_allowed_domains" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "oidc_button_label" text;