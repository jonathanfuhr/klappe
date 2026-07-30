ALTER TABLE "project_field_defs" ADD COLUMN "sortable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "project_field_defs" ADD COLUMN "groupable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "project_field_defs" ADD COLUMN "show_on_tile" boolean DEFAULT false NOT NULL;