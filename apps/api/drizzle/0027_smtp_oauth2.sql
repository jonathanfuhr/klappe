-- OAuth2 (Client-Credentials-Fluss gegen Entra ID) als zweite Authentifizierung
-- fuer den Mailversand. Microsoft 365 lehnt SMTP AUTH mit Kennwort ab, sobald
-- der Tenant Mehrfaktor-Anmeldung erzwingt -- dann bleibt nur OAuth2.
ALTER TABLE "app_settings" ADD COLUMN "smtp_auth_method" text DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "smtp_oauth_tenant_id" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "smtp_oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "smtp_oauth_client_secret_encrypted" text;
