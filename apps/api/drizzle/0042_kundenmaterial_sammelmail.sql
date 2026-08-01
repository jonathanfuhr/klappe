ALTER TABLE "project_files" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "project_files_pending_idx" ON "project_files" USING btree ("project_id","notified_at");--> statement-breakpoint
-- Alles, was vor dieser Migration hochgeladen wurde, gilt als berichtet.
-- Ohne diese Zeile stuende beim ersten Lauf der Sammelmail die gesamte
-- Kunden-Ablage in einer Mail – über Dateien, die laengst besprochen sind.
UPDATE "project_files" SET "notified_at" = "created_at" WHERE "notified_at" IS NULL;
--> statement-breakpoint
-- Kundenmaterial geht ab jetzt an die *eingetragenen* Personen statt an das
-- ganze Team. Damit bestehende Projekte dabei nicht still werden, wird der
-- Ersteller nachtraeglich eingetragen – so, wie es seit Phase 28 beim Anlegen
-- von selbst passiert.
INSERT INTO "notification_subscriptions" ("user_id", "project_id")
SELECT p."created_by_id", p."id"
FROM "projects" p
JOIN "users" u ON u."id" = p."created_by_id"
WHERE u."role" IN ('ADMIN', 'MEMBER')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Projekte ohne brauchbaren Ersteller (geloeschtes Konto, Gast) bekommen die
-- Admins. Lieber eine Mail zu viel als ein Kunden-Upload, den niemand sieht.
INSERT INTO "notification_subscriptions" ("user_id", "project_id")
SELECT u."id", p."id"
FROM "projects" p
CROSS JOIN "users" u
WHERE u."role" = 'ADMIN'
  AND u."is_active" = true
  AND NOT EXISTS (
    SELECT 1 FROM "notification_subscriptions" s WHERE s."project_id" = p."id"
  )
ON CONFLICT DO NOTHING;
