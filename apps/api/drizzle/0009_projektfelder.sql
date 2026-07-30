-- Benutzerdefinierte Projekt-Felder (Phase 15).
--
-- Die Definitionen sind workspace-weit und werden in den Einstellungen
-- gepflegt; eine Projektnummer ist der Anlassfall. Bewusst schlichte
-- Textfelder statt eines Typsystems. Die Werte hängen am Projekt; kein
-- Eintrag heißt, das Feld ist dort leer. Beide Kaskaden räumen mit: Fällt ein
-- Feld oder ein Projekt weg, verschwinden die zugehörigen Werte von selbst.
CREATE TABLE "project_field_defs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "project_field_defs_name_unique" ON "project_field_defs" (lower("name"));
--> statement-breakpoint
CREATE TABLE "project_field_values" (
  "project_id" uuid NOT NULL,
  "field_id" uuid NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_field_values_project_id_field_id_pk" PRIMARY KEY ("project_id", "field_id")
);
--> statement-breakpoint
ALTER TABLE "project_field_values" ADD CONSTRAINT "project_field_values_project_id_projects_id_fk"
  FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_field_values" ADD CONSTRAINT "project_field_values_field_id_project_field_defs_id_fk"
  FOREIGN KEY ("field_id") REFERENCES "public"."project_field_defs"("id") ON DELETE cascade ON UPDATE no action;
