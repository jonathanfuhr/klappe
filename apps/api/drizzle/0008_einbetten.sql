-- Einbetten pro Freigabe-Link.
--
-- Ein eingebetteter Player kommt ohne Anmeldung, ohne Code-Abfrage und ohne
-- Cookie aus – anders geht es in einem fremden `iframe` nicht, weil Browser
-- Cookies von Drittanbietern blockieren. Damit ist die Adresse allein der
-- Schlüssel. Deshalb ein eigener Schalter, der standardmäßig aus ist: Wer eine
-- Freigabe anlegt, öffnet damit nicht nebenbei den Player für die halbe Welt.
ALTER TABLE "share_links"
  ADD COLUMN "embed_enabled" boolean DEFAULT false NOT NULL;
