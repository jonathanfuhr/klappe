-- Phase 20: Der Gast gibt seinen Namen nur noch beim ersten Mal an.
--
-- Bisher: Link klicken -> Name UND Mail eingeben -> Code -> drin. Und zwar
-- jedes Mal, auch beim zwanzigsten Besuch. Neu: Link klicken -> Mail ->
-- Code -> beim ersten Mal der Name, danach nie wieder.
--
-- Der Standard "true" gilt fuer alle bestehenden Konten: Die haben ihren
-- Namen laengst angegeben und sollen nicht erneut gefragt werden. Nur frisch
-- angelegte Gastkonten bekommen ausdruecklich "false".
ALTER TABLE "users" ADD COLUMN "name_confirmed" boolean DEFAULT true NOT NULL;
