ALTER TABLE "ai_content_kinds" ADD COLUMN "key" text;--> statement-breakpoint
-- Die vier ab Werk ausgelieferten Arten bekommen ihren Code nachtraeglich.
-- Bedingung ist der unveraenderte Name: Wer eine davon schon umbenannt hat,
-- hat sie zu einer eigenen gemacht – die bleibt bei `null` und behaelt ihren
-- Namen, statt beim naechsten Sprachwechsel wieder umzuspringen.
UPDATE "ai_content_kinds" SET "key" = 'voice'  WHERE "name" = 'KI-Stimme';--> statement-breakpoint
UPDATE "ai_content_kinds" SET "key" = 'video'  WHERE "name" = 'KI-Video';--> statement-breakpoint
UPDATE "ai_content_kinds" SET "key" = 'sounds' WHERE "name" = 'KI-Sounds';--> statement-breakpoint
UPDATE "ai_content_kinds" SET "key" = 'music'  WHERE "name" = 'KI-Musik';
