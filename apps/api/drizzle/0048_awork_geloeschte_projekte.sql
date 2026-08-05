CREATE TABLE "awork_ignored_projects" (
	"awork_project_id" text PRIMARY KEY NOT NULL,
	"project_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
