# Architektur

## Überblick

```
Browser
   │  HTTPS (eine Herkunft)
   ▼
┌─────────┐   /v1/* per Rewrite    ┌─────────┐
│   web   │ ─────────────────────► │   api   │
│ Next.js │                        │ NestJS  │
└─────────┘                        └────┬────┘
                                        │ Job in die Warteschlange
                                        ▼
                            ┌─────────┐      ┌──────────┐
                            │  redis  │ ◄──► │  worker  │
                            │ BullMQ  │      │  ffmpeg  │
                            └─────────┘      └────┬─────┘
                                                  │
        ┌──────────┐                        ┌─────▼──────┐
        │ postgres │ ◄──── api + worker ───►│  Volume    │
        └──────────┘                        │  /data     │
                                            └────────────┘
```

## Entscheidungen und ihre Begründung

### Ein Image für API und Worker

`api` und `worker` starten aus demselben Image, nur mit unterschiedlichem
Kommando (`entrypoint.sh`). Damit ist ausgeschlossen, dass der Worker mit
anderem Code läuft als die API – ein Fehler, der sich sonst erst beim
nächsten Transcoding zeigt.

Getrennte **Prozesse** sind es trotzdem: Ein 4K-Transcoding lastet eine CPU
voll aus. Liefe es im API-Prozess, würden Seitenaufrufe währenddessen hängen.

### Frames sind die Einheit, nicht Sekunden

Alles, was mit einer Position im Video zu tun hat, wird als **Frame-Index**
gespeichert und gerechnet (0 = erstes Bild). Sekunden treten nur an zwei
Stellen auf: als `currentTime` des `<video>`-Elements und als Dauer in der
Anzeige.

Der Grund: Bei 29,97 fps ist eine Sekunde nicht 30 Bilder, und Fließkomma-
Sekunden runden bei jeder Umrechnung anders. Ein Kommentar auf „Sekunde
4,0333“ landet je nach Browser auf Frame 120 oder 121 – bei Frame 121 als
gespeichertem Wert kann das nicht passieren.

Die gesamte Umrechnung steht in `packages/shared/src/timecode.ts` und wird
von API, Worker und Browser gemeinsam benutzt. Drop-Frame (29,97 und 59,94)
ist dabei vollständig umgesetzt, inklusive Rückrichtung.

### Proxy mit identischer Framerate

Der Proxy wird mit `-fps_mode cfr` und der exakten Framerate des Originals
erzeugt. Nur so entspricht Frame N im Proxy genau Frame N im Original – und
nur dann meint ein Kommentar im Player dasselbe Bild, das der Cutter im
Schnittprogramm sieht. Nachgeprüft: Original und Proxy des Testmaterials
haben beide exakt 200 Frames.

`+faststart` schiebt den Index an den Dateianfang, sonst müsste der Browser
vor dem ersten Sprung die ganze Datei laden.

### Erst prüfen, dann kodieren

Ein fertig ausgespieltes 1080p-H.264-MP4 noch einmal durch x264 zu schicken
kostet Minuten und Qualität, ohne dass jemand etwas davon hat. Vor dem
Transcoding entscheidet deshalb `decidePlayback` in `media-plan.ts` anhand
der `ffprobe`-Daten:

| Ergebnis | Wann | Was passiert |
| --- | --- | --- |
| `ORIGINAL` | H.264, AAC/MP3/ohne Ton, `yuv420p`, MP4-/MOV-Container, kurze Kante ≤ Zielgröße, Bitrate im Rahmen, Index vorn | nichts – die Abspielfassung **ist** das Original |
| `REMUX` | wie oben, aber der Index liegt hinten | `-c copy -movflags +faststart`, Sekunden statt Minuten, Bild bitgleich |
| `TRANSCODE` | alles andere | vollständige Neukodierung |

Bei `ORIGINAL` zeigt `proxy_key` auf denselben Schlüssel wie `original_key` –
es wird keine zweite Datei angelegt. Ob der Index schon vorn liegt, verrät
kein `ffprobe`-Feld; dafür läuft `mp4-faststart.ts` die Box-Köpfe der Datei
ab (nur die Köpfe, nicht der Inhalt) und prüft, ob `moov` vor `mdat` kommt.

Entscheidung und Begründung stehen an der Fassung (`playback_mode`,
`playback_reason`) und sind in der Oberfläche sichtbar.

### Skaliert wird auf die kurze Kante

Nicht auf die Höhe. Ein Hochformat-Video ist 1080×1920, kein 1920×1080 –
würde man die Höhe deckeln, bekäme ein Hochformat-Clip einen 1080 Pixel hohen
Proxy mit 608 Pixel Breite. Die kurze Kante ist das Maß, das für Quer-, Hoch-
und Quadratformat gleichermaßen passt (`PROXY_SHORT_EDGE`, Standard 1080).
Vergrößert wird nie.

Dieselbe Regel gilt für die Auflösungsangabe im Download-Dateinamen:
`resolutionLabel` nennt die kurze Kante samt Bildrate, ein 2160×3840-Clip
heißt also `2160p25`.

### Posterframe und Sprite aus der Abspielfassung

Beide entstehen aus der fertigen Abspielfassung statt aus dem Original. Ein
zweiter Durchlauf über 4K-Material würde ein Vielfaches der Zeit kosten, ohne
dass man den Unterschied an einem 160 px breiten Vorschaubild sähe. Bei
`ORIGINAL` und `REMUX` ist beides dasselbe Bildmaterial.

### Dateinamen entstehen aus den Stammdaten

Was der Kunde herunterlädt, heißt nicht so, wie es die Kamera genannt hat,
sondern folgt dem Schema `JJMMTT_Kunde_Projekt_Video_v2_1080p25.mov`. Gebaut
wird der Name in `packages/shared/src/filenames.ts` – aus Projekt, Kunde,
Videoname, Versionsnummer, Auflösung und dem Datum der Fassung.

Das Datum ist bewusst das des Uploads und nicht das des Klicks: Es ist das
Datum, unter dem die Fassung in der Ablage geführt wird. Im Upload-Fenster
lässt es sich ändern, später auch noch an der Fassung selbst.

Der Unterstrich bleibt dem Trenner vorbehalten; Leerzeichen und Unterstriche
in Namen werden zu Bindestrichen, damit sich der Name eindeutig wieder
zerlegen lässt. Fehlende Teile fallen ersatzlos weg statt Lücken wie `__` zu
hinterlassen.

### Resumable Upload nach tus

Kameramaterial kommt in zweistelliger Gigabyte-Größe über WLAN und VPN.
Ein einzelner `POST` ist dafür untauglich. Umgesetzt ist tus 1.0.0
(Core, Creation, Termination) – ein etablierter Standard, den auch fertige
Clients wie Uppy sprechen.

Der Offset in der Datenbank ist die Wahrheit gegenüber dem Client. Vor jedem
Anhängen wird zusätzlich die tatsächliche Dateigröße auf der Platte geprüft:
Bricht eine Übertragung mittendrin ab, liegen bereits geschriebene Bytes vor,
und der gespeicherte Offset wird darauf korrigiert, bevor verglichen wird.
Sonst würde der Client genau dieses Stück beim Fortsetzen überspringen.

### Ein Upload-Fenster, das nicht am Seitenwechsel hängt

Die Warteschlange liegt im `UploadsProvider` im Wurzel-Layout, nicht in der
Projektseite. Wer während eines 40-GB-Uploads zu einem anderen Video wechselt,
verliert ihn also nicht. Das Fenster unten rechts lässt sich zuklappen und
wieder öffnen; die Übertragung läuft der Reihe nach, damit sich mehrere
Dateien nicht gegenseitig die Leitung wegnehmen.

Aus dem Dateinamen werden Projekt, Video und Versionsnummer **vorgeschlagen**
(`upload-hints.ts`: `V1`/`V01`/`version 2` erkennen, Kunden- und Projektnamen
punktebasiert vergleichen). Jeder Vorschlag trägt sichtbar den Zusatz *bitte
prüfen* – geraten wird viel, entschieden wird vom Menschen.

Fortschritt gibt es zweimal, weil es zwei Wartezeiten sind: das Hochladen
(aus dem tus-Offset) und die Verarbeitung (aus `-progress` des ffmpeg-Laufs,
per Nachfrage an der Fassung).

### Eine Herkunft für Oberfläche und API

Next.js leitet `/v1/*` an die API weiter. Dadurch braucht das Sitzungs-Cookie
keine Ausnahmen für fremde Herkünfte, es gibt kein CORS, und hinter einem
Tunnel oder Reverse Proxy muss nur ein Port veröffentlicht werden.

**Wichtig beim Bauen:** Next wertet `rewrites()` zur Bauzeit aus und schreibt
das Ziel fest in das Routen-Manifest. Die interne API-Adresse ist deshalb ein
Build-Argument (`API_INTERNAL_URL`, Standard `http://api:3001`) und keine
Laufzeitvariable. Wer API und Web getrennt veröffentlicht, setzt stattdessen
`NEXT_PUBLIC_API_BASE` auf die öffentliche API-Adresse.

### Ablage über Schlüssel

Der `StorageService` arbeitet mit relativen Schlüsseln (`proxies/<id>.mp4`)
statt mit absoluten Pfaden und prüft jeden davon gegen Ausbrüche mit `../`.
Eine spätere Umstellung auf S3/MinIO – im Konzept als Option vorgesehen –
betrifft dann nur diese eine Klasse.

### Passwörter mit scrypt aus der Standardbibliothek

Kein `bcrypt` (nativ zu übersetzen), kein zusätzliches Paket. Die Parameter
stehen im Hash (`scrypt$N$r$p$salt$hash`), sie lassen sich also später
erhöhen, ohne bestehende Konten zu brechen.

### Angemeldet sein ist die Voreinstellung

Ein global registrierter Guard schützt jede Route; Ausnahmen tragen
ausdrücklich `@Public()`. Eine neue Route ist damit im Zweifel geschützt und
nicht versehentlich offen. Der Benutzer wird bei jeder Anfrage frisch geladen –
ein gesperrtes Konto ist sofort draußen und nicht erst nach Ablauf des Tokens.

### Zugriffsrechte als reine Funktionen

Was ein Gast sehen, kommentieren, herunterladen und hochladen darf, steht in
`access/access-scope.ts` – ohne Datenbank, ohne Nest, nur Eingabe und
Entscheidung. Der `AccessService` lädt die Rechte pro Anfrage und ruft diese
Funktionen auf. Dadurch ist die eigentliche Regel für sich prüfbar, und der
Entzug eines Links wirkt sofort statt erst nach Ablauf einer Sitzung.

Der Download hängt an **drei** Schaltern, die alle zustimmen müssen: dem
Recht am Freigabe-Link, dem Schalter am Video und dem an der einzelnen
Fassung. Für das Team gilt keiner davon.

Fehlt der Zugriff, antwortet die API mit **404, nicht 403**. Ein 403 würde
verraten, dass es die ID gibt – ein Gast könnte damit fremde Projekte
abzählen.

### Gastzugang ohne Konto

Ein Freigabe-Link ist eine 24-stellige Zeichenkette aus einem Alphabet ohne
`0`, `o`, `1` und `l` (am Telefon vorlesbar), erzeugt mit Verwerfung statt
Modulo, damit die Verteilung gleich bleibt. Der Link allein genügt nicht:
Wer ihn öffnet, gibt seine E-Mail-Adresse an und bekommt einen sechsstelligen
Code zugeschickt. Fünf Fehlversuche je Code, fünf Codes je Stunde und
Adresse. Team-Adressen werden abgewiesen – die sollen sich anmelden, nicht
als Gast hereinkommen.

### E-Mail-Zugangsdaten verschlüsselt in der Datenbank

Das SMTP-Passwort wird in der Oberfläche eingegeben und liegt mit AES-256-GCM
verschlüsselt in `app_settings`; der Schlüssel wird aus `JWT_SECRET`
abgeleitet. Die API gibt es nie wieder heraus, sie meldet nur, *ob* eines
gesetzt ist.

### Rechte werden gezeigt, nicht nur durchgesetzt

Die Freigabeverwaltung beantwortet „welche Links gibt es". Die Gästeübersicht
(Phase 9) dreht die Frage um und zeigt Personen: über welche Links jemand
hereinkommt, was am Ende dabei herauskommt und wann er zuletzt da war.
Zusammengefasst wird in `guests/guest-summary.ts` – reine Rechnerei, ohne
Datenbank.

Entzogen wird pro **Person und Projekt**, nicht pro Link: Ein Link ist oft an
mehrere Leute gegangen, und einen davon auszuladen soll die anderen nicht
treffen. Der Vermerk „zuletzt gesehen" entsteht nebenher beim Laden der
Rechte, höchstens alle fünf Minuten je Gast – für die Frage „hat der Kunde
schon reingeschaut?" genügt diese Auflösung, und eine Schreiboperation pro
Anfrage wäre Verschwendung.

### Eine Farbe genügt

Beim White-Label (Phase 10) wählt der Admin **eine** Akzentfarbe. Hover-Ton
und lesbare Schriftfarbe darauf werden berechnet (`packages/shared/branding.ts`,
Relativhelligkeit nach WCAG). Wer drei Farben aufeinander abstimmen müsste,
säße am Ende vor weißer Schrift auf gelbem Grund.

Die Farben liegen ohnehin als CSS-Variablen vor; das Branding überschreibt
genau drei davon, keine Komponente wird angefasst. Das Logo wird als roher
Datenstrom hochgeladen statt als Formular – für eine einzelne kleine Datei ist
das schlichter, und der Server kommt ohne Formularbibliothek aus. Ein
SVG-Logo wird nur über `<img>` eingebunden, wo Skripte darin nicht laufen;
beim direkten Aufruf verhindert eine strenge CSP dasselbe.

### Zwei Sprachen ohne Bibliothek und ohne Sprachpfad

Klappe spricht seit Phase 26 Deutsch und Englisch. Dafür steht kein `next-intl`
im Projekt: Es legte die Sprache in die Adresse (`/de/projekte`), und damit
hinge jeder Link, jede Weiterleitung und die Sitzungs-Middleware daran. Für
zwei Sprachen ist das zu viel Umbau an zu vielen Stellen.

Stattdessen ein kleiner Kern in `packages/shared/src/i18n.ts`: flache Schlüssel
(`projects.new`), Einsetzungen als `{name}`, Plural über `{ one, other }`. Das
englische Wörterbuch ist als `Record<MessageKey, Message>` getippt – ein
fehlender Schlüssel bricht die Typprüfung, und `useT()` nimmt nur Schlüssel,
die es wirklich gibt. **Deutsch ist Quellsprache und zugleich Rückfall:** Eine
Stelle, die noch nicht umgezogen ist, zeigt Deutsch statt eines leeren Feldes.

Für die API ist es umgekehrt gelöst: Dort ist der **deutsche Satz der
Schlüssel** (`apps/api/src/i18n/api-messages.ts`), wie bei gettext. Die 229
Stellen, die eine Ausnahme werfen, bleiben unangetastet und lesbar; ein
globaler Fehlerfilter tauscht den Text erst beim Hinausgehen. Das hat einen
zweiten Grund: Erst dort steht fest, *wer* fragt – und damit, in welcher
Sprache er liest.

Das Handbuch und „Über diese Software" liegen nicht als Satzfragmente im
Wörterbuch, sondern je Sprache als eigene Datei. Ein Absatz mit `<strong>`,
`<code>` und Tabellen ließe sich sonst nur zerstückelt übersetzen, und beim
nächsten Umformulieren passte die Zerlegung nicht mehr.

### Anmeldung: zwei Wege, kein Weg in die Falle

Microsoft 365 (Phase 11) läuft als Authorization-Code-Fluss mit PKCE. Das
ID-Token wird gegen die JWKS des Tenants geprüft, obwohl es aus einer direkten
TLS-Verbindung stammt – der Aufwand ist gering, und bei einem Anmeldeweg will
man sich nicht auf „kommt schon vom Richtigen" verlassen. Geprüft werden
Signatur, Aussteller, Zielgruppe, Laufzeit und `nonce`.

Der Zustand zwischen Hin- und Rückweg liegt in einem signierten, kurzlebigen
Keks statt in der Datenbank: Ein angefangener Anmeldevorgang soll keinen
Neustart überleben, und es bleibt nichts liegen, das aufgeräumt werden müsste.

Zwei Vorkehrungen gegen Fußschüsse:

* **Unbekannte Adressen kommen nicht automatisch herein.** In einem großen
  Tenant bekäme sonst jeder Beschäftigte Zugriff auf alle Projekte.
* **Die lokale Anmeldung lässt sich nur abschalten, wenn M365 vollständig
  eingerichtet ist** – und lebt automatisch wieder auf, falls die Einrichtung
  später zerfällt. Sonst stünde man vor einer Anmeldeseite ohne Anmeldung.

### HTTPS ohne Zertifikatsgefummel

Zwei Wege, beide ohne Handarbeit an Zertifikaten:

- **Cloudflared-Tunnel.** Die Verbindung geht von innen nach außen, am Router
  bleibt jeder Port zu, der Server ist aus dem Internet nicht sichtbar. Nichts
  weiter einzurichten als der Tunnel selbst mit Ziel `http://web:3000`.
- **Eigene Domain, Ports 80/443 offen.** `docker-compose.https.yml` stellt
  Caddy davor; das Zertifikat holt und erneuert er selbst. Nötig sind nur
  `KLAPPE_DOMAIN` und `ACME_EMAIL`.

Damit die API hinter beiden erkennt, dass die Verbindung verschlüsselt ist,
steht in `main.ts` `trust proxy` – ohne das hielte Express jede Anfrage für
unverschlüsselt und setzte das Sitzungs-Cookie ohne `Secure`. Der Caddy-Block
reicht `X-Forwarded-Proto` weiter, gibt Antworten ungepuffert durch
(`flush_interval -1`, sonst stockt das Video) und setzt keine eigene Grenze
für die Anfragegröße – die kommt aus `UPLOAD_MAX_BYTES`.

### Kurzlebige Medien-Links statt eines zweiten Schlüssels

Die signierten Links aus Phase 13 (`media/media-token.ts`) sind kein
Ersatz für die Rechteprüfung, sondern ein anderer Ausweis: Sie sagen „diese
Person hat vor wenigen Minuten diesen Link angefordert". Ob sie die Datei
dann noch sehen darf, entscheidet nach wie vor der `AccessService` – ein
entzogener Zugang macht damit auch einen schon vergebenen Link wertlos.

Der Token ist an Fassung **und** Art gebunden, und eine Route nimmt ihn nur
an, wenn sie mit `@AllowMediaToken('proxy')` ausdrücklich dafür markiert ist.
Ohne diese Bindung wäre ein Link fürs Vorschaubild ein Ausweis für alles
Übrige.

### Bremsen im Prozessspeicher

Die Anfragebremse (`common/rate-limit.ts`) zählt in einem gleitenden Fenster
und liegt im Prozessspeicher – der Container betreibt genau eine API-Instanz,
ein Zähler in Redis wäre dieselbe Rechnung mit einem Netzwerkweg dazwischen.
Wird das später mehrinstanzig, ist genau diese Klasse die Stelle zum
Austauschen.

Ein Detail, das leicht falsch läuft: **Abgelehnte Versuche zählen nicht mit.**
Sonst könnte sich jemand durch stures Weiterklopfen selbst dauerhaft
aussperren – und ein Angreifer damit fremde Konten.

### Die awork-Anbindung schreibt, sie spiegelt nicht (Phase 30)

Klappe und awork führen dieselben Projekte, aber keine gemeinsame Datenbank.
Die Anbindung ist deshalb bewusst **einseitig gedacht**: Klappe schreibt, was
in awork als Arbeit oder als Nachricht ankommen soll – Korrekturen als Aufgabe,
alles Übrige als Projekt-Kommentar. Zurück kommt nur, was Klappe von sich aus
nicht wissen kann: dass ein neues Projekt entstanden ist.

Ein echter Abgleich in beide Richtungen bräuchte für jedes Feld eine Antwort
auf „welche Seite hat recht?", und die gibt es meistens nicht. Angeglichen wird
deshalb nur, was auf einer Seite **fehlt**.

**Die Aufgabenbeschreibung gehört vollständig Klappe.** Sie entsteht bei jeder
Änderung neu, nie durch Anhängen. Nur so stimmen auch nachträglich geänderte,
gelöschte und abgehakte Kommentare. Der Preis: Was jemand von Hand
hineinschreibt, ist beim nächsten Kommentar weg – deshalb steht ein Hinweis
darauf oben in der Beschreibung, und Notizen gehören in einen Aufgaben-Kommentar.

**Runden statt Wiederbeleben.** Ist die Aufgabe in awork erledigt und kommen
danach neue Kommentare, entsteht eine zweite. Eine abgehakte Aufgabe wieder
aufzureißen wäre unhöflich gegenüber dem, der sie abgehakt hat – und neue Punkte
still in ihre Beschreibung zu legen wäre schlimmer: Sie stünden dort, gelesen
hätte sie niemand.

**Ein kurzer Aufgaben-Kommentar bei jeder Erweiterung.** awork benachrichtigt
seine Bearbeiter bei einem Kommentar, nicht bei einer still geänderten
Beschreibung. Ohne diese Zeile bliebe jede Erweiterung unbemerkt.

**Gesammelt wird im Takt der Sammelmail.** Dieselbe Einstellung, dieselbe
Ruhezeit: Wer sein Postfach im Fünf-Minuten-Takt bekommt, will die Aufgabe nicht
im Sekundentakt aktualisiert sehen. Technisch trägt jeder Auftrag eine feste
Kennung; ein wartender Auftrag nimmt weitere Änderungen desselben Gegenstands
beim Ausführen von selbst mit, weil die Beschreibung ohnehin frisch entsteht.

**Zuordnung über die Projektnummer, einmal.** Ein Freifeld auf beiden Seiten,
der Kundenname als Gegenprobe. Weicht er ab, wird nicht stillschweigend
zugeordnet – eine falsche Zuordnung schriebe Korrekturen ins Projekt eines
fremden Kunden, und das fällt niemandem auf. Steht die Verknüpfung, bleibt sie
stehen; die Projektnamen dürfen sich danach frei auseinanderentwickeln.

**Abholen statt Webhook.** awork kann Webhooks, die bräuchten aber eine aus dem
Internet erreichbare Instanz – und abgesichert wären sie nur über einen
mitgeschickten Header, denn awork signiert nicht. Der Worker fragt deshalb alle
fünf Minuten nach; bei 1000 erlaubten Anfragen je Minute kostet das nichts, und
es läuft auch hinter einem Tunnel oder nur über Tailscale.

**Eine eigene Warteschlange.** awork darf ausfallen, ohne dass die Sammelpost
stehen bleibt: getrennte Wiederholungen, getrennte Fehlersuche. Was awork von
sich aus nicht mag – ein falscher Schlüssel, ein gelöschtes Projekt –, endet
nach dem ersten Versuch im Protokoll statt in fünf Anläufen.

**Zwei Eigenheiten der awork-API** prägen den Client: `PUT` ersetzt immer das
ganze Objekt (fehlende Felder werden geleert), deshalb wird vor jedem Schreiben
frisch gelesen; und `setassignees` ersetzt die komplette Bearbeiterliste,
deshalb kommen die vorhandenen Bearbeiter mit. Wer in awork von Hand jemanden
eingetragen hat, behält ihn – Klappe weiß nicht, warum er dort steht.

## Was der Worker tut

1. `ffprobe` liest Dauer, Framerate als Bruch, Auflösung, Codecs, Pixelformat,
   Container und den Start-Timecode (aus dem `tmcd`-Strom, dem Videostrom oder
   den Container-Tags, in dieser Reihenfolge).
2. `decidePlayback` entscheidet `ORIGINAL`, `REMUX` oder `TRANSCODE` (siehe
   oben) und hält die Begründung an der Fassung fest.
3. Je nach Entscheidung: gar nichts, `-c copy` in einen neuen Container, oder
   der vollständige H.264-Lauf. Beim Transcoding wird der Fortschritt aus
   `-progress pipe:1` gelesen und in Prozent an der Version gespeichert, damit
   die Oberfläche ihn anzeigen kann.
4. Posterframe (10 % der Laufzeit, höchstens Sekunde 5).
5. Sprite-Streifen: etwa eine Kachel pro zwei Sekunden, höchstens 100, in
   Zehnerreihen.
6. Version auf `READY`.

Poster und Sprite dürfen scheitern, ohne die Version als fehlgeschlagen zu
markieren – ohne Abspielfassung geht dagegen nichts, das ist ein harter
Fehler.

Startet der Worker neu, während ein Transcoding lief, bliebe die Version auf
`PROCESSING` stehen. `TranscodeRecoveryService` reiht solche Fälle beim Start
erneut ein.

### Nacharbeit steht hinten an (Phase 19)

Was niemand gerade erwartet, läuft nicht mehr im selben Durchgang mit: Die
HLS-Stufenleiter und die Download-Formate sind eigene Aufträge. Die Fassung ist
damit früher `READY` – abspielbar ist sie mit dem Proxy ohnehin.

Der Vorrang steckt in einer Eigenheit von BullMQ: Aufträge **ohne** Priorität
werden vor allen priorisierten abgearbeitet. Die Abspielfassung bekommt deshalb
bewusst keine mitgegeben und drängelt sich immer vor; ein angefordertes Format
trägt `1`, Vorratsarbeit `10`. Ein laufender ffmpeg wird dabei nicht
abgebrochen – der nächste freie Platz geht an die Abspielfassung, nicht der
gerade belegte.

Das Zeitfenster ist eine Verzögerung beim Einreihen (`delayUntilWindow`),
keine Sperre im Worker: Der Auftrag wacht auf, wenn das Fenster offen ist. Es
gilt nur für die Vorratsarbeit; ein Format, auf das jemand gerade schaut, läuft
immer sofort.

Die Einstellungen dazu liest der Worker **vor jedem Auftrag** frisch aus der
Datenbank statt einmal beim Start. Deshalb greift eine Änderung in der
Oberfläche ab dem nächsten Auftrag, ohne dass der Container neu starten muss.
Einzige Ausnahme bleibt `WORKER_CONCURRENCY`: Die steht im Decorator des
Prozessors und damit fest, bevor überhaupt eine Datenbankverbindung existiert.

## Grenzen des jetzigen Stands

- **Ein Container, ein Workspace.** So im Konzept entschieden. Der
  prozessweite Schreibschutz für Upload-Sitzungen setzt genau das voraus;
  mehrere API-Instanzen bräuchten dafür ein Schloss in Redis.
- **Live-Update ohne Inhalt.** Seit Phase 18 hängt an jeder offenen Seite ein
  Ereignisstrom (SSE über Redis), der aber nur meldet, *dass* sich etwas
  geändert hat. Die Daten holt die Oberfläche danach über die gewohnten,
  rechtegeprüften Wege. Der alte Takt bleibt als Netz darunter, falls ein
  Proxy SSE kappt.
- **Keine Zugriffsprüfung pro Projekt fürs Team.** Alle Team-Mitglieder sehen
  alle Projekte – so vorgesehen. Für Gäste gilt der Freigabe-Link.
- **E-Mail geht raus oder gar nicht.** Fehlgeschlagene Zustellungen werden von
  BullMQ wiederholt; was danach übrig bleibt, steht seit Phase 18 unter
  **Einstellungen → E-Mail-Versand** mit Empfänger, Betreff und der Meldung
  des Servers im Klartext. Ein späterer geglückter Versand räumt den Eintrag
  selbst weg.
- **Die Anfragebremse ist prozessweit.** Mit mehreren API-Instanzen zählte
  jede für sich. Bei einem Container pro Workspace ist das genau richtig.
- **HLS ist die Ausbaustufe, nicht der Normalfall.** Frame-genaues Arbeiten
  läuft über den progressiven Proxy; die Leiter kommt nur dazu.
- **Dateien werden verzögert gelöscht.** Beim Löschen eines Videos werden die
  Blobs direkt entfernt; was dabei liegen bleibt, holt der tägliche Aufräumer
  aus Phase 13 mit einem Tag Karenz nach – seit Phase 19 auch die erzeugten
  Download-Formate unter `renditions/`.
