-- Doppelte Sammelmails (gefunden beim Prüfen von Phase 18 in den Logs vom
-- 29.07.2026: drei identische Mails in derselben Sekunde an denselben
-- Empfänger). Jeder Kommentar reiht einen eigenen Digest-Job ein; wurden
-- mehrere zugleich fällig, las jeder dieselben wartenden Zeilen und
-- verschickte sie. Mit dieser Spalte greift sich ein Job seine Zeilen in
-- einer einzigen Anweisung – wer zu spät kommt, findet nichts mehr vor.
ALTER TABLE "pending_notifications" ADD COLUMN "claimed_at" timestamp with time zone;
--> statement-breakpoint
-- Der Zugriff läuft immer über (Empfänger, Video) und die freien Zeilen.
CREATE INDEX "pending_notifications_offen_idx"
  ON "pending_notifications" ("user_id", "video_id")
  WHERE "claimed_at" IS NULL;
