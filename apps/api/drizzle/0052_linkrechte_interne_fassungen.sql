ALTER TABLE "share_link_grants" ADD COLUMN "internal_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "share_link_grants" ADD COLUMN "internal_release" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "project_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "internal_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "internal_release" boolean DEFAULT false NOT NULL;