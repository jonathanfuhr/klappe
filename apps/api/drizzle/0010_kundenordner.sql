-- Der Kunden-Bereich wird eine echte Ordnerstruktur (Phase 15).
--
-- Ein schlichter Baum über `parent_id`; NULL heißt Wurzelebene. Die Kaskade
-- auf sich selbst räumt beim Löschen eines Ordners den ganzen Ast ab, die
-- Dateien darin fallen über ihre eigene Kaskade mit. Bestehende Dateien
-- bleiben mit `folder_id = NULL` auf der Wurzelebene liegen – für sie ändert
-- sich nichts.
CREATE TABLE "project_folders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "parent_id" uuid,
  "name" text NOT NULL,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_folders" ADD CONSTRAINT "project_folders_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_folders" ADD CONSTRAINT "project_folders_parent_fk"
  FOREIGN KEY ("parent_id") REFERENCES "public"."project_folders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_folders" ADD CONSTRAINT "project_folders_created_by_id_users_id_fk"
  FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "project_folders_project_idx" ON "project_folders" ("project_id");
--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "folder_id" uuid;
--> statement-breakpoint
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_folder_id_project_folders_id_fk"
  FOREIGN KEY ("folder_id") REFERENCES "public"."project_folders"("id") ON DELETE cascade ON UPDATE no action;
