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

## Grenzen des jetzigen Stands

- **Ein Container, ein Workspace.** So im Konzept entschieden. Der
  prozessweite Schreibschutz für Upload-Sitzungen setzt genau das voraus;
  mehrere API-Instanzen bräuchten dafür ein Schloss in Redis.
- **Kein Live-Update.** Fortschritt und neue Kommentare kommen durch
  regelmäßiges Nachladen, nicht über eine offene Verbindung.
- **Keine Zugriffsprüfung pro Projekt fürs Team.** Alle Team-Mitglieder sehen
  alle Projekte – so vorgesehen. Für Gäste gilt der Freigabe-Link.
- **E-Mail geht raus oder gar nicht.** Fehlgeschlagene Zustellungen werden von
  BullMQ wiederholt und danach protokolliert; eine Anzeige in der Oberfläche,
  welche Mail nicht ankam, gibt es noch nicht.
- **Dateien werden verzögert gelöscht.** Beim Löschen eines Videos werden die
  Blobs direkt entfernt; bleibt dabei etwas liegen (etwa weil das Dateisystem
  klemmt), räumt es derzeit niemand nach. Ein Aufräum-Job dafür gehört in
  Phase 13.
