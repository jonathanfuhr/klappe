# Klappe

Selbst gehostetes Review- und Freigabe-Werkzeug für Videoproduktionen – die
eigene Alternative zu Frame.io. Läuft vollständig im Docker-Container auf
eigener Infrastruktur.

**Stand: alle 14 Phasen der Umsetzungsreihenfolge sind gebaut.**

| Phase | Inhalt | Stand |
| --- | --- | --- |
| 0 | Fundament: Repo, docker-compose, Postgres-Schema, Basis-API, lokales Team-Login | fertig |
| 1 | Projekte & Videos: CRUD, resumable Upload (tus), Versionen | fertig |
| 2 | Pipeline: FFmpeg-Worker, Proxy, Thumbnails, Metadaten | fertig |
| 3 | Player: frame-genaue Wiedergabe, Timecode-/Frame-Counter, Shortcuts | fertig |
| 4 | Kommentare: an Timecode gebunden, Threads, @-Mentions | fertig |
| 5 | Zeichnen im Bild: Overlay pro Kommentar und Frame | fertig |
| 6 | Freigaben & Gäste: Links, Zugang per E-Mail-Code, Download-Rechte | fertig |
| 7 | Kunden-Uploads: Ablage je Projekt, auch für Gäste | fertig |
| 8 | E-Mail: SMTP-Einrichtung in der Oberfläche, Benachrichtigungen, Abmeldelink | fertig |
| 9 | Verwaltung: Gäste- und Rechteübersicht je Projekt und Video, Zugriff entziehen | fertig |
| 10 | Branding: Logo, Titel und Akzentfarbe pro Workspace | fertig |
| 11 | Microsoft 365: Anmeldung über Entra ID, wählbare Anmeldemethoden | fertig |
| 12 | Tags und Filter der Projektliste | fertig |
| 13 | Feinschliff: HLS-Ladder, signierte Medien-Links, Rate-Limits, Aufräum-Jobs | fertig |

## Was heute funktioniert

- **Anmeldung** mit lokalen Konten (E-Mail + Passwort), Rollen Admin /
  Team-Mitglied / Gast, Benutzerverwaltung für Admins.
- **Projekte und Videos** anlegen, umbenennen, löschen; Videos mit mehreren
  Versionen (v1, v2, …). Projekte tragen einen Kundennamen, der im
  Download-Dateinamen landet.
- **Upload großer Dateien** in Blöcken nach dem tus-Protokoll. Bricht die
  Verbindung ab, wird an genau der Stelle weitergemacht – geprüft mit einem
  abgerissenen 6-MB-Upload, dessen Ergebnis Byte für Byte der Quelle entspricht.
- **Ein Upload-Fenster für viele Dateien**: mehrere Dateien auf einmal, das
  Fenster lässt sich zuklappen und wieder öffnen, der Upload läuft beim
  Navigieren weiter. Pro Datei werden Projekt, Video und Versionsnummer aus
  dem Dateinamen vorgeschlagen – mit sichtbarem Hinweis, das bitte zu prüfen.
  Fortschritt gibt es zweimal: für das Hochladen und für die Verarbeitung.
- **Automatische Verarbeitung** jeder hochgeladenen Datei: `ffprobe` liest
  Start-Timecode, Framerate, Auflösung und Dauer, `ffmpeg` erzeugt Proxy,
  Posterframe und Sprite-Streifen für die Timeline-Vorschau. Vorher wird
  geprüft, ob Neukodieren überhaupt nötig ist (siehe unten).
- **Frame-genauer Player**: Live-Timecode und Frame-Zähler auf Basis von
  `requestVideoFrameCallback`, Einzelbildschritte, J/K/L, Sprünge an
  Anfang/Ende, Vollbild.
- **Kommentare am Bild**: an einen Frame geheftet, mit Antworten,
  @-Mentions, Erledigt-Status und Markern auf der Timeline.
- **Zeichnen im Bild**: freihändige Markierung auf dem Standbild, an denselben
  Frame geheftet wie der Kommentar. Die Striche liegen in relativen
  Koordinaten, sind also unabhängig von Fenster- und Videogröße.
- **Freigabe-Links für Kunden**: ohne Konto, Zugang über einen sechsstelligen
  Code per E-Mail. Pro Link einstellbar, ob kommentiert, heruntergeladen und
  hochgeladen werden darf und welche Videos sichtbar sind; Entzug wirkt sofort.
- **Kunden-Uploads**: eine Ablage je Projekt, in die Gäste Briefings, Logos
  oder Schnittfassungen legen können. Gäste sehen nur die eigenen Dateien.
- **E-Mail**: SMTP wird in der Oberfläche eingerichtet (Vorlagen für Brevo,
  Mailgun, Postmark, SES und Microsoft 365), mit Testmail. Benachrichtigt wird
  bei @-Mention und bei Antworten im eigenen Thread; jede Mail trägt einen
  Abmeldelink.
- **Downloads liefern immer das Original**, nie den Proxy – benannt nach dem
  Schema `JJMMTT_Kunde_Projekt_Video_v2_1080p25.mov`.
- **Wer hat Zugriff**: eine Übersicht je Projekt und je Video, wer über welchen
  Link hereinkommt, was er darf und wann er zuletzt da war. Der Zugang lässt
  sich einzelnen Personen entziehen, ohne den Link für alle anderen zu killen;
  unter *Gäste* stehen alle Gastkonten des Workspace.
- **Eigenes Erscheinungsbild**: Titel, Logo und Akzentfarbe gelten überall,
  auch auf der Anmeldeseite, im Gastzugang und in jeder E-Mail.
- **Anmeldung über Microsoft 365** (Entra ID) neben oder statt der lokalen
  Anmeldung – einstellbar in der Oberfläche, inklusive Schutz davor, sich
  selbst auszusperren.
- **Schlagworte und Filter** für die Projektliste, workspace-weit, mit
  Sortierung nach zuletzt bearbeitet, angelegt oder Name.
- **Adaptive Wiedergabe** über HLS (optional), kurzlebige Medien-Links für
  Werkzeuge ohne Sitzung, Bremsen an den empfindlichen Routen und ein
  täglicher Aufräumer für verwaiste Dateien.

## Schnellstart mit Docker

```bash
cp .env.example .env
# In .env mindestens POSTGRES_PASSWORD, JWT_SECRET, ADMIN_EMAIL und
# ADMIN_PASSWORD setzen. Geheimnisse erzeugen: openssl rand -hex 32
docker compose up -d --build
```

Danach läuft die Oberfläche auf <http://localhost:3000>. Beim ersten Start
wird aus `ADMIN_EMAIL` / `ADMIN_PASSWORD` ein Administrator angelegt; existiert
das Konto bereits, bleibt das Passwort unangetastet.

Für einen Test ohne HTTPS in `.env` zusätzlich `SESSION_COOKIE_SECURE=0`
setzen, sonst schickt der Browser das Sitzungs-Cookie nicht mit.

Nach außen wird nur der Dienst `web` veröffentlicht. Die API erreicht der
Browser über die Weiterleitung `/v1/*` in Next.js – Oberfläche und API laufen
so unter derselben Herkunft, was das Sitzungs-Cookie und den Betrieb hinter
einem Reverse Proxy deutlich vereinfacht.

## HTTPS

Ohne HTTPS geht es nicht: Das Sitzungs-Cookie wird mit `Secure` gesetzt, und
Freigabe-Links landen bei Kunden im Postfach. Es gibt zwei Wege, beide ohne
Zertifikate von Hand.

### Weg 1: Cloudflared-Tunnel (empfohlen, kein Port nach außen)

Der Tunnel baut die Verbindung von innen nach außen auf. Am Router muss
**nichts** freigegeben werden, die Adresse ist sofort per HTTPS erreichbar,
und der Server bleibt aus dem Internet unsichtbar. Das ist der einfachere
Weg, solange der Datenverkehr über Cloudflare laufen darf.

1. Bei Cloudflare unter *Zero Trust → Networks → Tunnels* einen Tunnel anlegen
   und den Token kopieren.
2. In der `.env` `PUBLIC_URL=https://klappe.example.org` setzen.
3. Den Tunnel als weiteren Dienst neben Klappe starten, mit
   `http://web:3000` als Ziel:

```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
```

Wichtig ist einzig, dass in Cloudflare bei den Tunnel-Einstellungen die
maximale Dateigröße nicht bremst – Uploads laufen in Blöcken von wenigen
Megabyte, sind also unkritisch, aber ein Limit auf der Cloudflare-Seite gilt
trotzdem pro Anfrage.

### Weg 2: Eigene Domain mit Portfreigabe

Wer den Verkehr nicht über Dritte leiten will, gibt am Router die Ports 80 und
443 frei und lässt Caddy das Zertifikat holen und erneuern:

```bash
# in .env:
#   KLAPPE_DOMAIN=klappe.example.org
#   ACME_EMAIL=technik@example.org
#   PUBLIC_URL=https://klappe.example.org
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d
```

Port 80 wird für die Zertifikatsprüfung gebraucht und leitet danach auf HTTPS
um. Die Ergänzung nimmt dem Dienst `web` die direkte Veröffentlichung ab, es
hört also nur noch Caddy nach außen. Der Proxy reicht `X-Forwarded-Proto`
weiter, gibt Antworten ungepuffert durch (sonst stockt das Video) und
deckelt die Anfragegröße nicht – die Grenze setzt `UPLOAD_MAX_BYTES`.

## Abspielfassung und Dateinamen

**Es wird nur neu kodiert, wenn es sein muss.** Vor dem Transcoding prüft der
Worker das Original: H.264, Ton als AAC oder MP3, Pixelformat `yuv420p`,
MP4-/MOV-Container, kurze Kante klein genug, Bitrate im Rahmen. Passt alles
und liegt der Index bereits vorn, wird die Datei **gar nicht angefasst** und
direkt abgespielt. Fehlt nur der vorgezogene Index, genügt ein Neuverpacken
(`-c copy`, Sekunden statt Minuten, Bild bitgleich). Erst wenn etwas nicht
passt, läuft x264. Was passiert ist, steht an der Fassung
(`ORIGINAL` / `REMUX` / `TRANSCODE`) samt Begründung.

**Skaliert wird auf die kurze Kante, nicht auf die Höhe.** `PROXY_SHORT_EDGE=1080`
heißt im Querformat 1920×1080, im Hochformat 1080×1920 und im Quadrat
1080×1080. Auf die Höhe zu skalieren, würde einem Hochformat-Clip einen
608 Pixel breiten Proxy verpassen.

**Heruntergeladen wird unter einem festen Schema:**

```
JJMMTT_Kunde_Projektname_Videoname_Versionsnummer_Auflösung.Dateiendung
260304_THD-Marketing_Sommer-Kampagne_Reel-Hochkant_v1_2160p25.mov
```

Das Datum ist das des Uploads und lässt sich im Upload-Fenster ändern. Die
Auflösung nennt die kurze Kante samt Bildrate (`2160p25`, `1080p50`,
`1080p2997`). Fehlende Teile – etwa ein Projekt ohne Kunden – fallen weg,
statt Lücken zu hinterlassen.

## Anmeldung über Microsoft 365

Einzurichten unter *Einstellungen → Anmeldung*, nicht in der `.env`.

1. Im Entra Admin Center eine App-Registrierung anlegen.
2. Unter *Authentifizierung* die Redirect-URI als **Web**-Plattform eintragen.
   Sie steht kopierfertig in den Einstellungen und endet auf
   `/v1/auth/microsoft/callback`.
3. Unter *Zertifikate & Geheimnisse* einen geheimen Clientschlüssel erzeugen.
4. Verzeichnis-ID, Anwendungs-ID und den Schlüssel in Klappe eintragen und
   den Schalter setzen.

Umgesetzt ist der Authorization-Code-Fluss mit PKCE; das ID-Token wird gegen
die öffentlichen Schlüssel des Tenants geprüft. Angefordert werden nur
`openid profile email` – Klappe braucht Name und Adresse, sonst nichts.

**Unbekannte Adressen kommen standardmäßig nicht herein.** Wer sich über M365
anmeldet, braucht hier bereits ein Konto. Das ist Absicht: In einem großen
Tenant bekäme sonst jeder Beschäftigte Zugriff auf alle Projekte. Wer das
anders will, schaltet das automatische Anlegen ein und schränkt es auf die
eigenen Domänen ein.

Die lokale Anmeldung lässt sich abschalten, sobald M365 vollständig
eingerichtet ist – vorher weist die API es ab, damit sich niemand aussperrt.
Fällt M365 später aus (Secret abgelaufen, Einstellungen gelöscht), lebt die
lokale Anmeldung automatisch wieder auf.

Gäste sind davon nie betroffen: Sie kommen immer über ihren Freigabe-Link mit
E-Mail-Code herein.

## Adaptive Wiedergabe (optional)

Mit `HLS_ENABLED=1` erzeugt die Pipeline zusätzlich eine HLS-Stufenleiter
(2160p / 1080p / 720p / 480p, je nachdem, was die Quelle hergibt). Der Player
nimmt sie automatisch, wo der Browser sie abspielt – Safari von Haus aus,
Chrome und Firefox über `hls.js`, das erst bei Bedarf nachgeladen wird.

Das kostet einen weiteren Durchlauf pro Datei und ist deshalb aus. Der
progressive Proxy bleibt in jedem Fall die Grundlage fürs frame-genaue
Arbeiten: eine Datei, sofort springbar, ohne Zwischenschicht.

## Entwicklung ohne Container

Voraussetzungen: Node 22, Docker (für Postgres und Redis), `ffmpeg` und
`ffprobe` im Pfad.

```bash
npm install
npm run build -w @klappe/shared     # gemeinsame Typen und Timecode-Mathematik

docker run -d --name klappe-pg -e POSTGRES_USER=klappe -e POSTGRES_PASSWORD=klappe \
  -e POSTGRES_DB=klappe -p 5432:5432 postgres:16-alpine
docker run -d --name klappe-redis -p 6379:6379 redis:7-alpine

export DATABASE_URL=postgres://klappe:klappe@localhost:5432/klappe
export REDIS_URL=redis://localhost:6379
export STORAGE_DIR=$PWD/data
export ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=start-klappe-2026
export SESSION_COOKIE_SECURE=0

npm run migrate      # Schema einspielen
npm run dev:api      # API auf Port 3001
npm run dev:worker   # Transcoding-Worker (eigenes Terminal)
npm run dev:web      # Oberfläche auf Port 3000 (eigenes Terminal)
```

Prüfen:

```bash
npm run typecheck    # alle Workspaces
npm test             # 344 Tests
npm run build        # shared + API + Web
```

Nach Änderungen am Datenmodell:

```bash
npm run db:generate  # erzeugt eine neue SQL-Migration in apps/api/drizzle/
```

## Aufbau

```
packages/shared      Typen der Schnittstelle, Timecode-Mathematik, Mention-Format,
                     Zeichnungsformat, Dateinamen, Erkennung im Dateinamen,
                     Schlagworte, Farbableitung fürs Branding
apps/api             NestJS: HTTP-API (main.ts) und Transcoding-Worker (worker.ts)
apps/api/drizzle     SQL-Migrationen
apps/web             Next.js: Oberfläche, Player, Kommentare, Upload-Fenster
docker/              Caddyfile für den HTTPS-Betrieb mit eigener Domain
docs/                Architektur, Datenmodell, API-Referenz
```

API und Worker laufen aus **einem** Image mit unterschiedlichem Kommando –
dadurch kann der Worker nicht mit anderem Code laufen als die API. FFmpeg
läuft ausschließlich im Worker, damit ein Transcoding die Oberfläche nicht
ausbremst.

Mehr dazu in [docs/architektur.md](docs/architektur.md),
[docs/datenmodell.md](docs/datenmodell.md) und [docs/api.md](docs/api.md).

## Tastaturkürzel im Player

| Taste | Wirkung |
| --- | --- |
| Leertaste | Abspielen / Pause |
| J / K / L | Rückwärts / Stopp / Vorwärts (mehrfach = schneller) |
| ← / → | Ein Bild zurück / vor |
| Umschalt + ← / → | Eine Sekunde zurück / vor |
| Pos1 / Ende | Erstes / letztes Bild |
| C | Kommentar am aktuellen Bild |
| D | Zeichnen am aktuellen Bild |
| M | Ton stumm |
| F | Vollbild |

## Sicherung

Zu sichern sind das Volume `media` (Originale, Proxys, Posterframes, Sprites)
und die Datenbank:

```bash
docker compose exec postgres pg_dump -U klappe klappe > klappe-$(date +%F).sql
```

Redis enthält nur die Warteschlange und muss nicht gesichert werden.

Der Worker räumt einmal täglich auf: verwaiste Dateien im Volume (mit einem
Tag Karenz, damit gerade entstehende Dateien in Ruhe bleiben), abgelaufene
Anmeldecodes und abgebrochene Upload-Sitzungen. Was er entfernt, steht im
Protokoll.

## Bekannte Hinweise

`npm audit` meldet eine Schwachstelle in `libvips` über `sharp`. Das Paket
ist eine **optionale** Abhängigkeit von Next.js und wird nur vom
Bildoptimierer benutzt – den schaltet `next.config.mjs` ausdrücklich ab, weil
Klappe alle Vorschaubilder als schlichtes `<img>` hinter der
API-Authentifizierung einbindet. Der betroffene Weg ist damit nicht
erreichbar. Ein `npm audit fix --force` würde Next auf Version 9 zurückstufen
und ist keine Lösung.
