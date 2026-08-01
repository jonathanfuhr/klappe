ALTER TABLE "video_versions" ADD COLUMN "internal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "video_versions" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_versions" ADD COLUMN "released_by_id" uuid;--> statement-breakpoint
ALTER TABLE "video_versions" ADD CONSTRAINT "video_versions_released_by_id_users_id_fk" FOREIGN KEY ("released_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_versions_internal_idx" ON "video_versions" USING btree ("video_id","internal");