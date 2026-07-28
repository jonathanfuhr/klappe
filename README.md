# Klappe

Selbst gehostetes Review- und Freigabe-Werkzeug für Videoproduktionen – die
eigene Alternative zu Frame.io. Läuft vollständig im Docker-Container auf
eigener Infrastruktur.

**Stand: Phasen 0 bis 4 der Umsetzungsreihenfolge sind gebaut.**

| Phase | Inhalt | Stand |
| --- | --- | --- |
| 0 | Fundament: Repo, docker-compose, Postgres-Schema, Basis-API, lokales Team-Login | fertig |
| 1 | Projekte & Videos: CRUD, resumable Upload (tus), Versionen | fertig |
| 2 | Pipeline: FFmpeg-Worker, 1080p-Proxy, Thumbnails, Metadaten | fertig |
| 3 | Player: frame-genaue Wiedergabe, Timecode-/Frame-Counter, Shortcuts | fertig |
| 4 | Kommentare: an Timecode gebunden, Threads, @-Mentions | fertig |
| 5–13 | Zeichnen, Freigaben & Gäste, Kunden-Uploads, E-Mail, Verwaltung, Branding, M365, Tags, Feinschliff | offen |

## Was heute funktioniert

- **Anmeldung** mit lokalen Konten (E-Mail + Passwort), Rollen Admin /
  Team-Mitglied / Gast, Benutzerverwaltung für Admins.
- **Projekte und Videos** anlegen, umbenennen, löschen; Videos mit mehreren
  Versionen (v1, v2, …).
- **Upload großer Dateien** in Blöcken nach dem tus-Protokoll. Bricht die
  Verbindung ab, wird an genau der Stelle weitergemacht – geprüft mit einem
  abgerissenen 6-MB-Upload, dessen Ergebnis Byte für Byte der Quelle entspricht.
- **Automatische Verarbeitung** jeder hochgeladenen Datei: `ffprobe` liest
  Start-Timecode, Framerate, Auflösung und Dauer, `ffmpeg` erzeugt einen
  1080p-H.264-Proxy mit `faststart`, einen Posterframe und einen
  Sprite-Streifen für die Timeline-Vorschau.
- **Frame-genauer Player**: Live-Timecode und Frame-Zähler auf Basis von
  `requestVideoFrameCallback`, Einzelbildschritte, J/K/L, Sprünge an
  Anfang/Ende, Vollbild.
- **Kommentare am Bild**: an einen Frame geheftet, mit Antworten,
  @-Mentions, Erledigt-Status und Markern auf der Timeline.
- **Downloads liefern immer das Original**, nie den Proxy.

Noch nicht enthalten (spätere Phasen): Zeichnen im Bild, Freigabe-Links und
Gastzugang per E-Mail-Code, Kunden-Upload-Ordner, E-Mail-Benachrichtigungen,
White-Label, Microsoft 365, Tags und Filter.

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
einem Cloudflared-Tunnel deutlich vereinfacht.

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
npm test             # 112 Tests
npm run build        # shared + API + Web
```

Nach Änderungen am Datenmodell:

```bash
npm run db:generate  # erzeugt eine neue SQL-Migration in apps/api/drizzle/
```

## Aufbau

```
packages/shared      Typen der Schnittstelle, Timecode-Mathematik, Mention-Format
apps/api             NestJS: HTTP-API (main.ts) und Transcoding-Worker (worker.ts)
apps/api/drizzle     SQL-Migrationen
apps/web             Next.js: Oberfläche, Player, Kommentare
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
| M | Ton stumm |
| F | Vollbild |

## Sicherung

Zu sichern sind das Volume `media` (Originale, Proxys, Posterframes, Sprites)
und die Datenbank:

```bash
docker compose exec postgres pg_dump -U klappe klappe > klappe-$(date +%F).sql
```

Redis enthält nur die Warteschlange und muss nicht gesichert werden.
