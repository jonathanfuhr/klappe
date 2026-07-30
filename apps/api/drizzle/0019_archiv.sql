-- Projekte archivieren (Phase 18, Zusatz).
--
-- `archived_at` liegt seit Phase 0 im Schema, hatte aber nie eine Oberflaeche.
-- Jetzt bekommt es eine: Ein archiviertes Projekt bleibt betrachtbar, zeigt
-- aber nur noch die neueste Fassung, und kommentieren geht nicht mehr. Die
-- aelteren Fassungen bleiben noch eine Weile liegen – falls das Archivieren
-- ein Irrtum war – und werden danach geloescht, um Platz zu schaffen.
ALTER TABLE "app_settings" ADD COLUMN "archive_retention_days" integer DEFAULT 30 NOT NULL;
