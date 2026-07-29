-- Endfassung markieren (Phase 17).
--
-- Ohne Haken sieht der Kunde einen Hinweis, dass die Fassung noch nicht final
-- ist, und der Downloadname trägt `Vorschau`. Standardmäßig aus: Beim
-- Hochladen ist eine Fassung erst einmal Zwischenstand – final wird sie durch
-- eine Entscheidung, nicht durch Vergesslichkeit. Bestehende Fassungen gelten
-- damit als nicht final; wer sie freigegeben hat, setzt den Haken nach.
ALTER TABLE "video_versions" ADD COLUMN "is_final" boolean DEFAULT false NOT NULL;
