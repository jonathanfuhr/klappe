-- Freitext fuer die Seite "Ueber diese Software": Auf welcher Umgebung
-- dieser Stack laeuft, zum Beispiel "laeuft auf nativer Hardware, kein NAS".
--
-- Nur der Admin vor Ort weiss, wo der Container tatsaechlich steht -- das
-- kann Klappe nicht selbst herausfinden, deshalb ein freies Textfeld statt
-- einer Automatik.
ALTER TABLE "app_settings" ADD COLUMN "environment_notes" text;
