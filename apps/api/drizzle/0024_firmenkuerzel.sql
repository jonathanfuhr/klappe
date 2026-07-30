-- Phase 20: Das Haus, dem der Workspace gehoert.
--
-- Der Name steht in den Einstellungen, das Kuerzel in Klammern hinter jedem
-- Namen aus dem eigenen Team. In einem Projekt sitzen Leute aus zwei
-- Haeusern; an einem Kommentar stand bisher nur ein Name.
ALTER TABLE "app_settings" ADD COLUMN "company_name" text;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "company_short" text;
