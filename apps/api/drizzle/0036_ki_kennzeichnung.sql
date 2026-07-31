CREATE TABLE "ai_content_kinds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_ai_kinds" (
	"video_id" uuid NOT NULL,
	"kind_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_ai_kinds_video_id_kind_id_pk" PRIMARY KEY("video_id","kind_id")
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "ai_content_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "ai_content" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "video_ai_kinds" ADD CONSTRAINT "video_ai_kinds_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_ai_kinds" ADD CONSTRAINT "video_ai_kinds_kind_id_ai_content_kinds_id_fk" FOREIGN KEY ("kind_id") REFERENCES "public"."ai_content_kinds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_content_kinds_name_unique" ON "ai_content_kinds" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "video_ai_kinds_kind_idx" ON "video_ai_kinds" USING btree ("kind_id");--> statement-breakpoint
INSERT INTO "ai_content_kinds" ("name", "sort_order") VALUES ('KI-Stimme', 0), ('KI-Video', 1), ('KI-Sounds', 2), ('KI-Musik', 3);
