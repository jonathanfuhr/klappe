-- Berechtigungen pro Person (Phase 16).
--
-- Bisher trug allein der Freigabe-Link die Rechte; jede Person am selben Link
-- hatte dieselben. Jetzt kann das Team einzelnen Gästen Rechte geben oder
-- nehmen: NULL heißt weiterhin „wie der Link“, ein gesetzter Wert ersetzt das
-- Link-Recht für genau diese Person.
ALTER TABLE "share_link_grants" ADD COLUMN "allow_download" boolean;
--> statement-breakpoint
ALTER TABLE "share_link_grants" ADD COLUMN "allow_upload" boolean;
--> statement-breakpoint
ALTER TABLE "share_link_grants" ADD COLUMN "allow_comments" boolean;
