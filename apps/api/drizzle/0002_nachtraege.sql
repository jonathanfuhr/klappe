CREATE TYPE "public"."playback_mode" AS ENUM('ORIGINAL', 'REMUX', 'TRANSCODE');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "customer" text;--> statement-breakpoint
ALTER TABLE "video_versions" ADD COLUMN "file_date" date;--> statement-breakpoint
ALTER TABLE "video_versions" ADD COLUMN "pixel_format" text;--> statement-breakpoint
ALTER TABLE "video_versions" ADD COLUMN "format_name" text;--> statement-breakpoint
ALTER TABLE "video_versions" ADD COLUMN "playback_mode" "playback_mode";--> statement-breakpoint
ALTER TABLE "video_versions" ADD COLUMN "playback_reason" text;