-- Versionsnummern mit Nachkommastellen.
--
-- Zwischen v2 und v3 liegt in der Praxis oft eine kleine Korrekturfassung. Die
-- soll v2.5 heißen dürfen, statt eine ganze Nummer zu verbrauchen. Drei
-- Nachkommastellen reichen dafür mit Abstand.
--
-- Bestehende Werte (1, 2, 3 …) bleiben unverändert, sie werden nur als 1.000,
-- 2.000 gespeichert. Der eindeutige Index auf (video_id, version_number) gilt
-- weiter und braucht kein Zutun: Postgres baut ihn beim Typwechsel neu auf.
ALTER TABLE "video_versions"
  ALTER COLUMN "version_number" TYPE numeric(8, 3) USING "version_number"::numeric(8, 3);
