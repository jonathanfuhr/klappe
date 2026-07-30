# Klappe auf einem Mac mit Apple Silicon

Apple Silicon bringt eine Media-Engine mit, die H.264 um ein Vielfaches
schneller kodiert als eine CPU in Software – ein Mac verwandelt damit auch
lange Kamerabänder in Minuten statt Stunden in Abspielfassungen. Das gilt
für jeden Mac mit M-Chip gleichermaßen, ob Mac Mini, Mac Studio, iMac oder
MacBook: VideoToolbox ist überall dieselbe Schnittstelle, die Modelle
unterscheiden sich nur im Tempo (Max- und Ultra-Chips bringen sogar mehrere
Media-Engines mit). Diese Seite beschreibt, wie Klappe auf so einem Mac
läuft.

Die eine Sache, die man dafür verstanden haben muss: **Docker läuft auf dem
Mac in einer Linux-VM, und in der gibt es Apples Hardware-Encoder
(VideoToolbox) nicht.** Ein Container kann auf dem Mac immer nur in Software
kodieren, egal wie er konfiguriert ist. Deshalb bleibt der Stack (Postgres,
Redis, API, Web, Caddy) im Container – dem ist Hardware egal –, und nur der
Worker läuft nativ auf macOS. Es ist derselbe Code, dieselbe Warteschlange
und derselbe Medienordner; der Worker verbindet sich einfach über
`127.0.0.1` statt über das Docker-Netz und bekommt per `VIDEO_ENCODER`
gesagt, dass er die Hardware nehmen soll.

## Voraussetzungen

```bash
brew install node@22 ffmpeg
```

Danach prüfen, dass der Hardware-Encoder wirklich da ist:

```bash
ffmpeg -hide_banner -encoders | grep h264_videotoolbox
```

Dazu Docker Desktop (oder OrbStack). Läuft der Mac ohne Monitor, in den
Einstellungen den Start von Docker beim Anmelden **und** die automatische
Anmeldung des Benutzers aktivieren – Docker Desktop startet erst mit der
Anmeldung, und ohne Docker gibt es keine Datenbank, auf die der Worker
warten könnte. (Er wartet geduldig; es dauert nur unnötig.)

Wie der Mac selbst für den Dauerbetrieb eingerichtet wird – Installation
von Homebrew und Docker, automatischer Start nach Stromausfall, kein
Ruhezustand, FileVault-Abwägung, SSH, Automount von Netzwerkpfaden – steht
gesammelt mit allen Terminal-Befehlen in [mac-server.md](mac-server.md).

## Stack starten

Die `.env` entsteht wie im README beschrieben. Zwei Punkte sind auf dem Mac
Pflicht:

- **`MEDIA_DIR` muss auf einen echten Host-Pfad zeigen**, etwa
  `MEDIA_DIR=/Users/dein-benutzer/klappe-media`. Das benannte Volume (der
  Standard) liegt in der Docker-VM und ist für den nativen Worker
  unsichtbar.
- `VIDEO_ENCODER` gehört **nicht** in die `.env` des Stacks – im Container
  gibt es kein VideoToolbox. Die Variable bekommt nur der native Worker.

Als Platte dafür am besten eine SSD (intern oder extern per USB/Thunderbolt),
keine Festplatte: Mit Hardware-Encoder wird das Transcoding schnell
plattenlimitiert – hochbitratiges 4K-Material liest sich bei mehrfacher
Echtzeit mit 250 MB/s und mehr, während gleichzeitig Proxy bzw. HLS-Stufen
zurückgeschrieben werden. Eine einzelne Festplatte bricht bei solchen
parallelen Strömen ein, und APFS ist auf rotierenden Platten ohnehin spürbar
träge. Fürs bloße Abspielen der fertigen 10-Mbit-Proxys würde eine
Festplatte reichen – nur wäre sie die Bremse genau an der Stelle, für die
der Mac angeschafft wurde. Das Archiv muss dafür nicht mit auf die SSD:
Ausgelieferte Projekte lassen sich archivieren, und die Sicherung
(README, Abschnitt Sicherung) gehört ohnehin auf ein anderes Gerät – etwa
per Automount auf ein NAS (siehe [mac-server.md](mac-server.md)).

Gestartet wird mit dem Mac-Overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.mac.yml up -d --build
```

Das Overlay macht zwei Dinge: Es bindet Postgres und Redis an `127.0.0.1`
(nur für den Worker auf diesem Mac; von außen zeigt weiterhin allein Caddy),
und es nimmt den Container-Worker aus dem Spiel. Der Tunnel- bzw.
HTTPS-Weg aus dem README funktioniert unverändert – die jeweilige Datei
einfach zusätzlich mit `-f` angeben.

Lief der Stack vorher schon einmal ohne das Overlay, den alten
Container-Worker einmal von Hand entfernen, sonst rechnen zwei Worker um
die Wette:

```bash
docker compose stop worker && docker compose rm -f worker
```

## Worker bauen und von Hand probieren

```bash
git clone https://github.com/DEIN-KONTO/klappe.git ~/klappe
cd ~/klappe
npm ci
npm run build:server
```

Vor der Einrichtung als Dienst lohnt ein Probelauf im Terminal – die Werte
entsprechen der `.env` des Stacks:

```bash
export NODE_ENV=production
export DATABASE_URL=postgres://klappe:DEIN-POSTGRES-PASSWORT@127.0.0.1:5432/klappe
export REDIS_URL=redis://127.0.0.1:6379
export JWT_SECRET=WIE-IN-DER-ENV        # wortgleich, siehe unten
export STORAGE_DIR=/Users/dein-benutzer/klappe-media   # exakt MEDIA_DIR
export PUBLIC_URL=https://klappe.example.org
export FFMPEG_PATH=/opt/homebrew/bin/ffmpeg
export FFPROBE_PATH=/opt/homebrew/bin/ffprobe
export VIDEO_ENCODER=h264_videotoolbox
node apps/api/dist/worker.js
```

Beim Start prüft der Worker selbst, ob das ffmpeg den gewählten Encoder
mitbringt, und meldet dann `Video-Encoder: h264_videotoolbox`. Steht dort
eine Fehlermeldung, stimmt `FFMPEG_PATH` nicht oder das ffmpeg kann kein
VideoToolbox – beides will man jetzt wissen und nicht beim ersten Upload.

Zwei Werte verzeihen keine Abweichung:

- **`STORAGE_DIR` = `MEDIA_DIR`, zeichengenau.** Der Worker muss denselben
  Medienbaum sehen wie die API. Ein anderer Pfad hieße: Proxys landen im
  Nirgendwo, und der tägliche Aufräumer des Workers hielte die Dateien der
  API für verwaist.
- **`JWT_SECRET` wortgleich zur `.env`.** Damit entschlüsselt der Worker das
  SMTP-Passwort und signiert Abmeldelinks; mit einem anderen Schlüssel
  scheitert der Mailversand.

### Erste Freigabe für den Medienordner (Wechselmedien-Berechtigung)

macOS behandelt jedes Volume unter `/Volumes` – auch eine intern verbaute
oder per USB/Thunderbolt angeschlossene SSD, wie oben für `MEDIA_DIR`
empfohlen – datenschutzrechtlich als **Wechselmedium**. Sobald `node` zum
ersten Mal wirklich in den Medienordner schreibt (also beim ersten
Transcoding-Auftrag, nicht schon beim bloßen Start des Prozesses), blendet
macOS einen Systemdialog ein ("„node" möchte auf ein Wechselmedium
zugreifen" o. ä.). Ohne Bestätigung bleibt der Auftrag hängen – im Log
steht dann nur der `ffprobe`-Aufruf, ohne dass je ein Ergebnis folgt, und
die Fortschrittsanzeige verharrt bei den ersten Prozent. Das betrifft den
manuellen Probelauf genauso wie den späteren launchd-Dienst.

Freigabe erteilen:

1. Erscheint der Dialog, **„Erlauben"** klicken.
2. Nachträglich prüfen/setzen lässt sich das unter Systemeinstellungen →
   Datenschutz & Sicherheit → Wechselmedien (dort muss `node` aktiviert
   sein).

Läuft der Worker schon als Dienst, danach einmal neu starten, damit ein
frischer Prozess mit der erteilten Freigabe läuft – der bereits blockierte
Prozess zieht sie nicht automatisch nach:

```bash
sudo launchctl kickstart -k system/de.fuhrzwei.klappe-worker
```

## Als Dienst einrichten (launchd)

Die Vorlage liegt unter `deploy/mac/de.fuhrzwei.klappe-worker.plist`. Alle
GROSS-GESCHRIEBENEN Platzhalter ersetzen, dann:

```bash
sudo cp deploy/mac/de.fuhrzwei.klappe-worker.plist /Library/LaunchDaemons/
sudo chown root:wheel /Library/LaunchDaemons/de.fuhrzwei.klappe-worker.plist
sudo chmod 644 /Library/LaunchDaemons/de.fuhrzwei.klappe-worker.plist
plutil -lint /Library/LaunchDaemons/de.fuhrzwei.klappe-worker.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/de.fuhrzwei.klappe-worker.plist
```

Kontrolle:

```bash
sudo launchctl print system/de.fuhrzwei.klappe-worker | grep -E 'state|pid'
tail -f ~/Library/Logs/klappe-worker.log
```

Ein LaunchDaemon startet beim Hochfahren, ohne dass sich jemand anmeldet;
`KeepAlive` startet den Worker nach einem Absturz oder Update-Stopp neu.
Dass Postgres und Redis nach einem Neustart erst später bereitstehen, macht
nichts – der Worker verbindet sich von sich aus neu, sobald sie da sind.

## Rechte-Probe vor dem ersten echten Upload

API (Container) und Worker (nativ) schreiben in denselben Ordner – einmal in
beide Richtungen beweisen, dass das klappt:

```bash
docker compose exec api sh -c 'echo probe > /data/rechte-probe.txt'
cat "$MEDIA_DIR/rechte-probe.txt"        # muss „probe“ zeigen
echo antwort >> "$MEDIA_DIR/rechte-probe.txt"
docker compose exec api cat /data/rechte-probe.txt   # muss beide Zeilen zeigen
rm "$MEDIA_DIR/rechte-probe.txt"
```

Docker Desktop gleicht den Dateibesitz zwischen Container und Host
automatisch ab; diese Probe stellt sicher, dass das auch im konkreten
Ordner gilt.

## Aktualisieren

API-Container und nativer Worker sind ein und derselbe Code-Stand – beim
Aktualisieren gehören beide zusammen erneuert:

```bash
cd ~/klappe
git pull
npm ci
npm run build:server
docker compose -f docker-compose.yml -f docker-compose.mac.yml up -d --build
sudo launchctl kickstart -k system/de.fuhrzwei.klappe-worker
```

Nach einem `brew upgrade ffmpeg` einmal einen Blick ins Log werfen bzw. eine
Datei zur Probe hochladen – ein neues ffmpeg kann sich im Detail anders
verhalten.

## Umzug von einem bestehenden Server

Reihenfolge beachten: Erst die Datenbank einspielen, **dann** den Stack
vollständig starten – die API legt beim Start sonst ein frisches Schema an,
und der Import beißt sich mit den schon vorhandenen Tabellen.

1. Auf dem alten Server sichern (siehe README, Abschnitt Sicherung):

   ```bash
   docker compose exec postgres pg_dump -U klappe klappe > klappe-umzug.sql
   ```

2. Auf dem Mac nur die Datenbank starten und den Stand einspielen:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.mac.yml up -d postgres
   docker compose exec -T postgres psql -U klappe klappe < klappe-umzug.sql
   ```

3. Den Medienordner übertragen, etwa per `rsync -a` auf den Pfad aus
   `MEDIA_DIR`.

4. **`JWT_SECRET` aus der alten `.env` übernehmen** – daraus leitet sich der
   Schlüssel ab, mit dem SMTP-Passwort und OIDC-Secret verschlüsselt sind.
   Mit einem neuen Secret wären beide unlesbar und müssten in den
   Einstellungen neu hinterlegt werden.

5. Restlichen Stack starten (`up -d`), Worker einrichten wie oben. Redis
   muss nicht mit umziehen – dort liegen nur Warteschlangen und Ereignisse.

Zum Schluss den Zugang umziehen: Beim Cloudflared-Tunnel genügt es, den
Tunnel auf dem Mac einzurichten (README, Abschnitt HTTPS); bei eigener
Domain die Portfreigabe auf den Mac umstellen.

## Was auf dem Mac anders ist

- Das x264-Preset (Einstellungen → Transcode bzw. `PROXY_PRESET`) hat mit
  VideoToolbox keine Wirkung – Hardware kennt keine Presets. Die Bitraten
  gelten unverändert, auch für die Download-Formate und die HLS-Leiter.
- `WORKER_CONCURRENCY=1` darf bleiben: Schon ein einzelner Auftrag lastet
  die Media-Engine gut aus, und die HLS-Leiter kodiert ohnehin alle Stufen
  gleichzeitig.
- Reicht die Hardware einmal nicht (viele parallele Sitzungen), rechnet
  Apples eingebauter Software-Encoder weiter, statt den Auftrag
  abzubrechen – dafür sorgt `-allow_sw` in den ffmpeg-Argumenten.
- Beim allerersten Transcoding-Auftrag fragt macOS einmalig nach der
  Freigabe für Wechselmedien, sobald der Worker in den Medienordner
  schreibt – ohne Bestätigung bleibt der Auftrag hängen. Siehe
  „Erste Freigabe für den Medienordner" im Abschnitt „Worker bauen und von
  Hand probieren".
