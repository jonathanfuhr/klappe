ALTER TABLE "videos" ADD COLUMN "downloads_final_only" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Die beiden alten Schalter (`videos.downloads_enabled`, `video_versions.
-- download_enabled` – Phase 5) fallen in 0045 weg. Sie waren eine dritte
-- Ebene neben dem Recht am Freigabe-Link und der Ausnahme je Person, standen
-- unbeschriftet ueber dem Player und wurden auf dieser Anlage nie benutzt
-- (0 von 4 Videos, 0 von 5 Fassungen, geprueft am 02.08.2026).
--
-- Uebrig bleibt der eine Fall, den sie allein abdecken konnten: „nur die
-- Endfassung darf raus". Wer eine der Spalten doch gesetzt hatte, verliert
-- diese Einschraenkung - deshalb hier eine Meldung ins Protokoll statt eines
-- stillen Wegfalls.
DO $$
DECLARE gesperrt integer;
BEGIN
  SELECT (SELECT count(*) FROM "videos" WHERE "downloads_enabled" = false)
       + (SELECT count(*) FROM "video_versions" WHERE "download_enabled" = false)
    INTO gesperrt;
  IF gesperrt > 0 THEN
    RAISE WARNING 'Klappe: % Download-Sperre(n) aus Phase 5 entfallen. Bitte die Download-Rechte an den Freigabe-Links pruefen.', gesperrt;
  END IF;
END $$;
