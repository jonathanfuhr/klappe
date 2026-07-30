-- Die Projektliste filtert nach allem (Phase 16).
--
-- `suggest`: Tippvorschläge aus den Werten der anderen Projekte, je Feld
-- schaltbar – für einen Kundennamen hilfreich, für eine einmalige
-- Projektnummer sinnlos. Vorsichtshalber aus.
-- `tags_enabled`: Wer nur mit den benutzerdefinierten Feldern arbeitet,
-- blendet die Schlagworte damit überall aus; die Daten bleiben erhalten.
ALTER TABLE "project_field_defs" ADD COLUMN "suggest" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "tags_enabled" boolean DEFAULT true NOT NULL;
