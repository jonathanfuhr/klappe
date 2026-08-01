# Handbuch für Benutzer und Gäste

Dieses Handbuch richtet sich an alle, die mit Klappe arbeiten – Team-Mitglieder
ebenso wie Kundinnen und Kunden, die als Gast eingeladen wurden. Es
beschreibt, wie man sich anmeldet, Videos ansieht und kommentiert, Fassungen
hochlädt, Freigaben verwaltet und wo man was findet.

Es ist dasselbe Handbuch, das innerhalb der Anwendung unter **Handbuch** in
der Kopfzeile steht. Dort gibt es seit Phase 26 auch eine englische Fassung;
diese Datei bleibt die deutsche. Wer wissen will, wer die Software gebaut hat und auf
welcher Umgebung dieser Klappe-Stack läuft, findet das auf der Seite **Über
diese Software** daneben.

---

## Inhalt

- [Anmelden](#anmelden)
- [Die Oberfläche im Überblick](#die-oberfläche-im-überblick)
- [Projekte, Videos und Fassungen](#projekte-videos-und-fassungen)
- [Hochladen](#hochladen)
- [Der Player](#der-player)
- [Kommentieren und Zeichnen](#kommentieren-und-zeichnen)
- [Freigeben](#freigeben)
- [Als Gast bei Klappe](#als-gast-bei-klappe)
- [Kunden-Ablage](#kunden-ablage)
- [Herunterladen](#herunterladen)
- [Benachrichtigungen](#benachrichtigungen)
- [Mein Konto](#mein-konto)
- [Geräte verbinden](#geräte-verbinden)
- [Einstellungen (Team)](#einstellungen-team)
- [Häufige Fragen](#häufige-fragen)

---

## Anmelden

**Team-Mitglieder** melden sich mit E-Mail-Adresse und Passwort an, oder –
falls der Workspace es eingerichtet hat – über den Microsoft-365-Knopf auf
der Anmeldeseite.

**Gäste** brauchen kein Konto und kein Passwort. Es gibt zwei Wege herein:

1. **Über einen Freigabe-Link.** Ein Klick auf den Link führt zu einer
   Adresse, die zunächst nach der E-Mail-Adresse fragt. Danach kommt eine
   Mail mit einem sechsstelligen Code – der Code eintragen, fertig. Nach dem
   Namen wird nur **beim allerersten Besuch** gefragt; danach nie wieder. Wer
   noch angemeldet ist, geht beim nächsten Klick auf denselben Link ganz ohne
   Zwischenschritt hindurch.
2. **Über den Gastzugang auf der Anmeldeseite**, falls der Link einmal nicht
   zur Hand ist. Auch hier reichen E-Mail-Adresse und Code. Das legt kein
   neues Konto an – für eine Adresse, die noch nirgends freigeschaltet wurde,
   verschickt Klappe schlicht keine Mail, und die Absage steht direkt im
   Browser.

Ein Anmeldecode ist einige Minuten gültig. Kommt keine Mail an, lohnt ein
Blick in den Spam-Ordner; wer öfter Post von Klappe bekommen soll, sollte den
Absender als sicher einstufen.

---

## Die Oberfläche im Überblick

Die Kopfzeile ist überall gleich:

- **Logo/Titel** links führt zur Projektliste.
- **Projekte** zeigt alle Projekte, auf die man Zugriff hat.
- **Handbuch** und **Über diese Software** – diese beiden Seiten hier.
- **Einstellungen** steht nur Team-Mitgliedern und Admins zur Verfügung.
- Rechts das Glockensymbol für die **Benachrichtigungszentrale**, daneben der
  eigene Name (führt zu **Mein Konto**) und der Abmelden-Knopf.

Ein Projekt öffnet die Liste seiner Videos; ein Video öffnet den Player mit
der neuesten Fassung. Von dort aus lässt sich jederzeit zwischen den
Fassungen wechseln.

---

## Projekte, Videos und Fassungen

Die Struktur ist immer **Projekt → Video → Fassung**. Ein Video kann beliebig
viele Fassungen tragen (v1, v2, v2.5, v3 …) – wer schneidet, lädt für jede
neue Version eine neue Fassung hoch, die alte bleibt erhalten und
vergleichbar.

In der Projektliste steht der **Kunde groß über dem Projektnamen** – wer viele
Projekte betreut, findet so zuerst den Kunden und dann das Projekt. Je nach
Einrichtung stehen auf der Kachel auch einzelne benutzerdefinierte Felder,
etwa eine Projektnummer.

Eine Fassung kann als **Endfassung** markiert sein. Ist sie das nicht, sieht
jeder, der sie ansieht, einen deutlichen Hinweis darauf, dass es sich um
einen Zwischenstand handelt.

Davon unabhängig gibt es den Haken **intern**: Damit bleibt eine Fassung im
Haus, bis jemand aus dem Team sie freigibt. Gäste sehen sie bis dahin
nirgends – nicht in der Fassungsliste, nicht als neueste Fassung und nicht im
Download-Fenster. Beim Hochladen ist der Haken wählbar (auch bei mehreren
Dateien einzeln), und er lässt sich später jederzeit umlegen. Freigeben darf
**jeder aus dem Team**, nicht nur ein Admin; danach steht an der Fassung, wer
sie wann freigegeben hat.

Ein archiviertes Projekt bleibt sichtbar und abspielbar, zeigt aber nur noch
die jeweils neueste fertige Fassung je Video, und es lässt sich nicht mehr
kommentieren. Das entscheidet ein Team-Mitglied oder ein Admin; als Gast
merkt man davon nur, dass ältere Zwischenstände irgendwann nicht mehr da
sind.

---

## Hochladen

Das Upload-Fenster liegt unten rechts und lässt sich ein- und ausklappen. Es
nimmt beliebig viele Dateien auf einmal an – auch ganze Ordner per
Drag & Drop – und läuft beim Wechsel zwischen Seiten einfach weiter.

Die Übertragung geht in kleinen Blöcken. Bricht die Verbindung mittendrin ab
(WLAN weg, Laptop zugeklappt), geht es beim nächsten Versuch genau an der
Stelle weiter, an der es aufgehört hat – auch ein sehr großes Kameraband ist
damit kein Risiko.

Aus dem Dateinamen schlägt Klappe Projekt, Video und Versionsnummer vor
(erkennt zum Beispiel `V1`, `V01`, `version 2`). Jeder Vorschlag ist deutlich
als *bitte prüfen* markiert – angelegt wird erst, wenn aktiv auf **Speichern**
geklickt wird.

Nach dem Hochladen braucht Klappe kurz Zeit, um die Datei fürs Web
aufzubereiten (Abspielfassung, Vorschaubild). Der Fortschritt dafür läuft
getrennt vom Upload-Fortschritt, weil es zwei unterschiedliche Wartezeiten
sind.

**Wer darf hochladen?** Team-Mitglieder immer. Gäste nur, wenn ein
Freigabe-Link das ausdrücklich erlaubt – das steht an jedem Link einzeln.

---

## Der Player

Der Player spielt **frame-genau**: Was im Player als Frame 812 angezeigt
wird, ist exakt Frame 812 im Schnittprogramm – kein Rätselraten mehr, welche
Sekunde gemeint war.

### Tastenkürzel

| Taste | Wirkung |
| --- | --- |
| Leertaste | Abspielen / Pause |
| J / K / L | Rückwärts / Stopp / Vorwärts (mehrfach drücken = schneller) |
| ← / → | Ein Bild zurück / vor |
| Umschalt + ← / → | Eine Sekunde zurück / vor |
| Pos1 / Ende | Erstes / letztes Bild |
| C | Kommentar am aktuellen Bild |
| D | Zeichnen am aktuellen Bild |
| M | Ton stumm |
| F | Vollbild |

Am Telefon im Querformat passt sich das Layout an; wird es eng, weicht als
Erstes die Frame-Nummer, der Timecode bleibt immer sichtbar.

Im **Vollbild** lässt sich weiter kommentieren: Der Kommentar-Knopf (oder die
Taste **C**) fährt die Kommentarspalte von rechts ins Bild; das Kreuz oben
schließt sie wieder.

### Wiedergabequalität

Steht für ein Video die adaptive Wiedergabe bereit, erscheint in der
Steuerleiste eine **Qualitätswahl**. Normalerweise steht sie auf **Auto** –
Klappe wählt die Stufe dann nach der gemessenen Verbindung, und die gerade
gespielte Stufe steht in Klammern dabei. Wer eine bestimmte Stufe sehen will
(etwa garantiert 1080p für die Abnahme), wählt sie fest; *Auto* gibt die Wahl
wieder an die Automatik zurück. In Safari übernimmt der Browser die Wahl
selbst, dort gibt es den Umschalter nicht.

---

## Kommentieren und Zeichnen

Ein Kommentar hängt an einem **einzelnen Frame**, nicht an einer ungefähren
Sekunde. Auf einen Kommentar lässt sich antworten, man kann jemanden mit
`@Name` erwähnen (die Person bekommt dann Bescheid), und ein Kommentar lässt
sich als **erledigt** markieren, sobald er abgearbeitet ist. Sortiert wird
wahlweise nach Timecode oder nach Erstellungszeit.

Dazu gibt es ein **Zeichenwerkzeug**: Mit der Maus oder dem Finger lässt sich
direkt auf dem Standbild in mehreren Farben markieren, was gemeint ist – der
Strich hängt am selben Frame wie der Kommentar und bleibt unabhängig von
Fenstergröße immer an der richtigen Stelle.

**Tipp:** Bild an der richtigen Stelle anhalten, Taste **C** drücken (oder
**D** fürs Zeichnen), Anmerkung eintippen bzw. malen, abschicken. Das ist
schneller als jeder Klick durch Menüs.

---

## Freigeben

Ein Freigabe-Link lässt sich auf ein ganzes **Projekt** oder auf ein
einzelnes **Video** ausstellen. Beim Anlegen wird festgelegt:

- Darf über den Link **kommentiert** werden?
- Darf **heruntergeladen** werden?
- Darf über den Link **hochgeladen** werden?

Diese Rechte lassen sich zusätzlich **pro Person** abweichend vom Link
setzen, falls eine einzelne eingeladene Person mehr oder weniger dürfen soll
als der Rest.

Neben dem Player liegt die Spalte **Freigaben** mit allen Personen, die
Zugriff haben. Ein Zugang lässt sich jederzeit **entziehen** – das wirkt
sofort und trifft nur die eine Person; alle anderen behalten ihren Zugang
über denselben Link.

### Externer Projektadmin

Für die Zusammenarbeit mit Agenturen kann das Team einen Gast an seiner
Projektfreigabe zum **Externen Projektadmin** machen. Er darf dann in genau
diesem Projekt Videos anlegen, eigene Fassungen hochladen und löschen, weiter
freigeben und fremde Kommentare verwalten – also selbst Material einstellen,
statt nur zu kommentieren. Projekt und Videos umbenennen oder löschen bleibt
dem Team vorbehalten, ebenso das Ändern bestehender Freigabe-Links.

### Einbetten

Ein Video lässt sich in eine fremde Seite einbetten – über das
**„…"-Menü → Einbetten** am Video, nicht über die Freigaben. Das ist bewusst
getrennt: Ein Freigabe-Link lädt zum Anmelden und Kommentieren ein, ein
Einbett-Link zeigt nur den Player.

Der Einbett-Link ist deshalb ein eigener Link. Mit ihm kann sich niemand
anmelden, er taucht in der Freigabenliste nicht auf, und ausgeliefert wird
ausschließlich die neueste **Endfassung** – ohne gesetzten Endfassungs-Haken
bleibt der Player leer. Kommentare, Gästeliste und Download gibt es dort
nicht; die Adresse selbst ist der einzige Schlüssel. Zurückziehen wirkt
sofort.

---

## Als Gast bei Klappe

Als Gast sieht man genau das, wozu man eingeladen wurde – ein einzelnes
Video oder ein ganzes Projekt, je nachdem, welcher Link oder welche
Erweiterung genutzt wurde. Man kann:

- die freigegebenen Videos ansehen (frame-genau, mit allen Tastenkürzeln),
- kommentieren und zeichnen, sofern der Link das erlaubt,
- herunterladen, sofern der Link das erlaubt,
- eigenes Material hochladen (Kunden-Ablage oder neue Fassung), sofern der
  Link das erlaubt.

Ein eigenes Passwort gibt es nicht – der Zugang läuft ausschließlich über
E-Mail-Adresse und den zugeschickten Code. Wurde der eigene Zugang
zurückgezogen, führt auch ein alter Link nicht mehr herein; in dem Fall
braucht es eine neue Einladung.

---

## Kunden-Ablage

Jedes Projekt hat einen eigenen Bereich für Kundenmaterial – Briefings,
Logos, eigene Schnittfassungen. Er funktioniert wie ein gewöhnlicher Ordner:
Unterordner anlegen, Dateien hochladen, umbenennen, löschen. Ein ganzer
Ordner lässt sich auch als ZIP-Datei herunterladen.

Wer Zugang zu einem Projekt hat, sieht den gesamten Bereich dieses Projekts.

---

## Herunterladen

Der **Herunterladen**-Knopf öffnet immer ein Fenster – auch wenn keine
zusätzlichen Formate eingerichtet sind. Dort steht der Dateiname, unter dem
die Datei gleich landet, und bei einer Fassung ohne Endfassungs-Haken die
Warnung, dass hier ein Zwischenstand das Haus verlässt. Ganz oben steht immer
das **Original** – die unveränderte hochgeladene Datei. Je nach Einrichtung des
Workspace stehen darunter zusätzliche fertige Formate zur Auswahl; ein Klick
darauf erzeugt die Datei bei Bedarf und startet den Download automatisch,
sobald sie fertig ist.

Heruntergeladene Dateien tragen einen sprechenden Namen nach folgendem
Schema:

```
JJMMTT_Kunde_Projektname_Videoname_Versionsnummer_Auflösung.Dateiendung
260304_Beispiel-Marketing_Sommer-Kampagne_Reel-Hochkant_v1_2160p25.mov
```

---

## Benachrichtigungen

Wer über neue Kommentare an einem Video informiert werden möchte, trägt sich
in der Spalte **Benachrichtigungen** ein – für ein ganzes Projekt oder ein
einzelnes Video. Wer selbst eine neue Fassung hochlädt, wird für dieses
Video automatisch eingetragen.

Mails werden meist **gebündelt** verschickt: Erst wenn eine Weile lang kein
neuer Kommentar mehr dazukam, geht eine Sammelmail heraus, statt für jede
einzelne Anmerkung eine eigene Mail zu verschicken.

Unabhängig davon gibt es die **Benachrichtigungszentrale**: das Glockensymbol
in der Kopfzeile mit der Anzahl ungelesener Einträge. Dort steht sofort, wer
was wo geschrieben hat – auch wenn gerade kein Mailversand eingerichtet ist
oder die Mail übersehen wurde. Auch Gäste haben diese Zentrale.

---

## Mein Konto

Unter **Mein Konto** (Klick auf den eigenen Namen in der Kopfzeile) lässt
sich der eigene **Name** ändern – so, wie er in Kommentaren, Listen und
Benachrichtigungen erscheint. Das gilt für Team und Gäste gleichermaßen.

Dort steht auch die **Sprache** – Deutsch oder Englisch. Sie gilt für die
Oberfläche, für Fehlermeldungen und für die eigenen E-Mails. Ohne eigene Wahl
gilt die Einstellung des Workspace.

Team-Mitglieder ändern dort außerdem ihr **Passwort**. Gäste haben keines –
ihr Zugang läuft über den Mail-Code.

---

## Geräte verbinden

Programme außerhalb des Browsers können mit Klappe arbeiten – ein Plugin im
Schnittprogramm etwa, das Kommentare als Marker in die Timeline holt. Damit das
geht, muss der Administrator unter *Einstellungen → API-Zugriff* den externen
Zugriff erlaubt haben; ab Werk ist er aus.

So verbindet man ein Gerät:

1. Das Programm zeigt einen achtstelligen Code an, etwa `KHFP-3RTM`, dazu eine
   Adresse.
2. Diese Adresse im Browser öffnen (oder unter **Mein Konto → Verbundene
   Geräte** auf *Gerät verbinden* gehen) und den Code eintragen.
3. Es erscheint, welches Programm sich verbinden will. Bestätigen – fertig.
   Das Programm meldet sich innerhalb weniger Sekunden von selbst.

**Ein Passwort wird dabei nirgends eingetippt.** Es zählt die Anmeldung, die im
Browser ohnehin schon steht – ob sie mit Passwort oder über Microsoft 365
zustande kam, spielt keine Rolle.

Ein verbundenes Programm bekommt **genau die eigenen Rechte**: Es sieht
dieselben Projekte und Videos, kommentiert unter dem eigenen Namen und darf
herunterladen und hochladen, soweit man selbst darf. Deshalb nur bestätigen,
was man gerade selbst gestartet hat.

Alle verbundenen Geräte stehen unter **Mein Konto**. *Trennen* wirkt sofort und
trifft nur dieses eine Gerät – das Passwort bleibt unberührt, alle anderen
Geräte laufen weiter. Wer einen Laptop verliert, trennt also genau ihn. Das
geht ohne den Administrator; er kann seinerseits jedes Gerät im Workspace
trennen und den externen Zugriff insgesamt wieder abschalten.

Auch Gäste können Geräte verbinden. Ein solches Programm sieht dann genau das,
was der Gast auch im Browser sieht – seine Freigaben, nicht mehr.

---

## Benachrichtigungen einstellen (Admin)

*Einstellungen → Benachrichtigungen.* Dort steht jede Art von Mail, die Klappe
verschickt, mit **zwei Haken**: einer für das Team, einer für Gäste. Was hier
aus ist, geht nicht raus.

Der Anmeldecode für Gäste steht ohne Schalter in der Liste – ohne ihn käme kein
Gast mehr herein.

Drei Ebenen greifen nacheinander: Der Schalter hier kann nur **zumachen**.
Darunter entscheidet weiter, wer für ein Projekt eingetragen bzw. an einem
Gespräch beteiligt ist, und ganz unten das persönliche Abbestellen unter
*Profil und Sicherheit*.

Auf derselben Seite stehen die **Sammelmails**: eine Ruhezeit für Kommentare
und eine eigene, deutlich höhere für Kundenmaterial. Ein Kunde lädt selten eine
Datei, sondern einen Ordner – aus zwanzig Dateien soll eine Mail werden und
nicht zwanzig. Erwähnungen dürfen die Ruhezeit überspringen.

Ganz unten die zwei Schalter für **interne Fassungen**: ob das Haus die interne
Runde überhaupt fährt und ob neue Fassungen ab Werk intern sind.

## Einstellungen (Team)

Team-Mitglieder und Admins finden unter **Einstellungen** unter anderem:

- **Gäste** – wer Zugang hat, wo überall, und die Möglichkeit, ihn zu
  entziehen.
- **Benutzer**, **Benutzerdefinierte Felder**, **Projekte** – Verwaltung, dem
  Admin vorbehalten.
- **Erscheinungsbild** – Titel, Logo, Akzentfarbe und Sprache des Workspace.
- **Anmeldung** – lokale Konten und/oder Microsoft 365.
- **API-Zugriff** – ob Programme außerhalb des Browsers mit Klappe arbeiten
  dürfen (ab Werk aus), und alle verbundenen Geräte des Workspace.
- **E-Mail-Versand** – SMTP-Einrichtung, Bündel-Zeitfenster, unzustellbare
  Mails.
- **Transcode** – welche Download-Formate angeboten werden und wann sie
  erzeugt werden.
- **Speicher** – wie viel Platz auf der Platte noch frei ist und wie viel
  davon Klappe belegt.
- **Datensicherung** – ob und wie oft die Datenbank gesichert wird, und die
  Möglichkeit, eine Sicherung wieder einzuspielen.

---

## Häufige Fragen

**Ich habe keinen Code bekommen.** Im Spam-Ordner nachsehen. Bleibt die Mail
aus, ist entweder der Mailversand des Workspace nicht eingerichtet oder die
eigene Adresse hat (noch) keine Freigabe – in dem Fall hilft nur eine neue
Einladung durch das Team.

**Mein alter Link funktioniert nicht mehr.** Dann wurde der Zugang für die
eigene Adresse zurückgezogen. Das Team kann eine neue Freigabe ausstellen.

**Warum sehe ich beim Video einen Hinweis "kein Endstand"?** Die angezeigte
Fassung ist ausdrücklich noch nicht als fertig markiert – ein Zwischenstand,
kein Ergebnis.

**Ich sehe im Frame-Zähler eine andere Zahl als im Schnittprogramm.** Sollte
nicht vorkommen – die Abspielfassung übernimmt bewusst die Framerate des
Originals. Bei Abweichungen bitte das Team informieren.

**Wo steht, wer diese Software gebaut hat und wo sie läuft?** Auf der Seite
**Über diese Software**, verlinkt in derselben Kopfzeile wie dieses
Handbuch.
