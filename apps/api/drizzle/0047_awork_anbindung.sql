CREATE TABLE "awork_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reference_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "awork_project_links" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"awork_project_id" text NOT NULL,
	"awork_project_name" text,
	"matched_by" text DEFAULT 'nummer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "awork_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"awork_task_id" text NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"closed" boolean DEFAULT false NOT NULL,
	"synced_comment_count" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "awork_users" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"awork_user_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_api_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_project_number_field_id" uuid;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_project_number_custom_field_id" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_task_list_name" text DEFAULT 'Postproduktion' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_task_title_prefix" text DEFAULT 'Korrektur: ' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_fallback_user_id" uuid;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_auto_create_projects" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_write_back_link" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_sync_project_number" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_event_kundenmaterial" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_event_erstbesuch" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_event_fassung_verfuegbar" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_event_endfassung" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_event_aufgabe_erledigen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_poll_last_run_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_last_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "awork_last_error" text;--> statement-breakpoint
ALTER TABLE "awork_notices" ADD CONSTRAINT "awork_notices_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awork_project_links" ADD CONSTRAINT "awork_project_links_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awork_tasks" ADD CONSTRAINT "awork_tasks_version_id_video_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."video_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "awork_users" ADD CONSTRAINT "awork_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "awork_notices_kind_reference_idx" ON "awork_notices" USING btree ("kind","reference_id");--> statement-breakpoint
CREATE INDEX "awork_notices_project_idx" ON "awork_notices" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "awork_project_links_awork_idx" ON "awork_project_links" USING btree ("awork_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "awork_tasks_version_round_idx" ON "awork_tasks" USING btree ("version_id","round");--> statement-breakpoint
CREATE INDEX "awork_tasks_version_idx" ON "awork_tasks" USING btree ("version_id");--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_awork_project_number_field_id_project_field_defs_id_fk" FOREIGN KEY ("awork_project_number_field_id") REFERENCES "public"."project_field_defs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_awork_fallback_user_id_users_id_fk" FOREIGN KEY ("awork_fallback_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;