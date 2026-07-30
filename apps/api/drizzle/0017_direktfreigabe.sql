-- Direktfreigabe (Phase 18).
--
-- Ein Gast, der bisher nur ein Video sehen darf, laesst sich jetzt mit einem
-- Klick auf weitere Videos oder aufs ganze Projekt erweitern – ohne dass ihm
-- jemand einen neuen Link schicken und er sich neu anmelden muss. Technisch
-- entsteht dabei ein Freigabe-Link wie jeder andere, nur verschickt ihn
-- niemand. Diese Markierung sagt der Oberflaeche, dass sie die Adresse nicht
-- anbieten soll: Ein Link, den man nicht verschicken will, braucht keinen
-- Kopierknopf.
ALTER TABLE "share_links" ADD COLUMN "is_direct" boolean DEFAULT false NOT NULL;
