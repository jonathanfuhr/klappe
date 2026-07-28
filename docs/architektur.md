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

Der 1080p-Proxy wird mit `-fps_mode cfr` und der exakten Framerate des
Originals erzeugt. Nur so entspricht Frame N im Proxy genau Frame N im
Original – und nur dann meint ein Kommentar im Player dasselbe Bild, das der
Cutter im Schnittprogramm sieht. Nachgeprüft: Original und Proxy des
Testmaterials haben beide exakt 200 Frames.

`+faststart` schiebt den Index an den Dateianfang, sonst müsste der Browser
vor dem ersten Sprung die ganze Datei laden.

### Posterframe und Sprite aus dem Proxy

Beide entstehen aus dem fertigen Proxy statt aus dem Original. Ein zweiter
Durchlauf über 4K-Material würde ein Vielfaches der Zeit kosten, ohne dass
man den Unterschied an einem 160 px breiten Vorschaubild sähe.

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

### Eine Herkunft für Oberfläche und API

Next.js leitet `/v1/*` an die API weiter. Dadurch braucht das Sitzungs-Cookie
keine Ausnahmen für fremde Herkünfte, es gibt kein CORS, und hinter dem
Cloudflared-Tunnel muss nur ein Port veröffentlicht werden.

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

## Was der Worker tut

1. `ffprobe` liest Dauer, Framerate als Bruch, Auflösung, Codecs und den
   Start-Timecode (aus dem `tmcd`-Strom, dem Videostrom oder den
   Container-Tags, in dieser Reihenfolge).
2. `ffmpeg` erzeugt den 1080p-H.264-Proxy. Der Fortschritt wird aus
   `-progress pipe:1` gelesen und in Prozent an der Version gespeichert, damit
   die Oberfläche ihn anzeigen kann.
3. Posterframe (10 % der Laufzeit, höchstens Sekunde 5).
4. Sprite-Streifen: etwa eine Kachel pro zwei Sekunden, höchstens 100, in
   Zehnerreihen.
5. Version auf `READY`.

Poster und Sprite dürfen scheitern, ohne die Version als fehlgeschlagen zu
markieren – ohne Proxy geht dagegen nichts, das ist ein harter Fehler.

Startet der Worker neu, während ein Transcoding lief, bliebe die Version auf
`PROCESSING` stehen. `TranscodeRecoveryService` reiht solche Fälle beim Start
erneut ein.

## Grenzen des jetzigen Stands

- **Ein Container, ein Workspace.** So im Konzept entschieden. Der
  prozessweite Schreibschutz für Upload-Sitzungen setzt genau das voraus;
  mehrere API-Instanzen bräuchten dafür ein Schloss in Redis.
- **Kein Live-Update.** Fortschritt und neue Kommentare kommen durch
  regelmäßiges Nachladen, nicht über eine offene Verbindung.
- **Keine Zugriffsprüfung pro Projekt.** Alle Team-Mitglieder sehen alle
  Projekte – so vorgesehen. Die Einschränkung für Gäste kommt mit den
  Freigaben in Phase 6.
- **Dateien werden verzögert gelöscht.** Beim Löschen eines Videos werden die
  Blobs direkt entfernt; bleibt dabei etwas liegen (etwa weil das Dateisystem
  klemmt), räumt es derzeit niemand nach. Ein Aufräum-Job dafür gehört in
  Phase 13.
