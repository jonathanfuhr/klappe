# API-Referenz

Alle Routen liegen unter `/v1`. Angemeldet sein ist Pflicht, außer wo anders
vermerkt. Die Sitzung steckt im Cookie `klappe_session` (httpOnly); alternativ
geht `Authorization: Bearer <token>`.

Die Antwortformen sind in `packages/shared/src/types.ts` typisiert – die
Web-App benutzt exakt dieselben Typen.

## Anmeldung

| Route | Zweck |
| --- | --- |
| `POST /v1/auth/login` | `{ email, password }` → setzt das Sitzungs-Cookie, liefert `{ user }` |
| `POST /v1/auth/logout` | Cookie löschen (204) |
| `GET /v1/auth/me` | angemeldetes Konto |
| `POST /v1/auth/password` | `{ currentPassword, newPassword }` (204) |

Falsche Zugangsdaten und unbekannte Adressen ergeben dieselbe Antwort, damit
sich vorhandene Konten nicht abfragen lassen.

## Benutzer

| Route | Rolle |
| --- | --- |
| `GET /v1/users` | Admin |
| `POST /v1/users` | Admin – `{ email, name, password, role? }` |
| `PATCH /v1/users/:id` | Admin – `{ name?, role?, isActive?, password? }` |
| `PATCH /v1/me` | alle – `{ name?, notificationsEnabled? }` |
| `GET /v1/mentionable-users?q=` | alle – Vorschläge für @-Mentions |

Passwörter: mindestens 10 Zeichen, Buchstaben und Ziffern.

## Projekte und Videos

| Route | Zweck |
| --- | --- |
| `GET /v1/projects` | Liste, zuletzt bearbeitete zuerst |
| `POST /v1/projects` | `{ name, description? }` |
| `GET/PATCH/DELETE /v1/projects/:id` | einzeln |
| `GET /v1/projects/:id/videos` | Videos mit jeweils neuester Version |
| `POST /v1/projects/:id/videos` | `{ name, description? }` |
| `GET/PATCH/DELETE /v1/videos/:id` | einzeln |
| `GET /v1/videos/:id/versions` | alle Versionen, neueste zuerst |
| `GET/PATCH/DELETE /v1/versions/:id` | einzeln; die letzte Version eines Videos lässt sich nicht löschen |

## Upload (tus 1.0.0)

Unterstützt: Core, Creation, Termination.

```
POST /v1/videos/:videoId/uploads
  Upload-Length: 42949672960
  Upload-Metadata: filename <base64>,filetype <base64>
  — oder als JSON: { filename, sizeBytes, mimeType?, label? }
→ 201, Location: /v1/uploads/<id>, Rumpf: UploadSessionDto

HEAD /v1/uploads/:id
→ 200, Upload-Offset, Upload-Length, Cache-Control: no-store

PATCH /v1/uploads/:id
  Content-Type: application/offset+octet-stream
  Upload-Offset: <aktueller Stand>
  <Rohdaten>
→ 204, Upload-Offset: <neuer Stand>
  beim letzten Block zusätzlich Klappe-Version-Id

DELETE /v1/uploads/:id   → 204, bricht ab und räumt auf
OPTIONS /v1/uploads/:id  → 204, Tus-Version / Tus-Extension
```

Fehlerfälle:

| Lage | Antwort |
| --- | --- |
| Offset passt nicht zum Server | `409` – der Stand steht in der Meldung, per `HEAD` abfragen |
| Upload bereits vollständig | `409` |
| mehr Bytes als angekündigt | `413` |
| falscher `Content-Type` | `415` |
| Sitzung abgebrochen oder unbekannt | `404` |

Nach dem letzten Block wandert die Datei an ihren endgültigen Ort, die
Version geht auf `PROCESSING` und das Transcoding wird eingereiht.

Bricht die Verbindung mitten im Block ab, bleiben die bereits geschriebenen
Bytes erhalten: Der nächste `HEAD` liefert den tatsächlichen Stand.

## Medien

| Route | Zweck |
| --- | --- |
| `GET/HEAD /v1/versions/:id/proxy` | Playback-Proxy, mit `Range`-Unterstützung (206) |
| `GET/HEAD /v1/versions/:id/original` | **immer die Originaldatei**; `?inline=1` unterdrückt den Download-Header |
| `GET /v1/versions/:id/poster` | Posterframe (JPEG) |
| `GET /v1/versions/:id/sprite` | Kachelbild für die Timeline-Vorschau (JPEG) |

Ein unerfüllbarer `Range` ergibt `416` mit `Content-Range: bytes */<größe>`.
Poster und Sprite ändern sich nie und werden entsprechend lange
zwischengespeichert.

Die Kachel zu einem Zeitpunkt: `index = floor(sekunden / intervalSeconds)`,
begrenzt auf `tileCount - 1`; daraus `spalte = index % columns` und
`zeile = floor(index / columns)`.

## Kommentare

| Route | Zweck |
| --- | --- |
| `GET /v1/versions/:id/comments` | Wurzelkommentare mit ihren Antworten |
| `POST /v1/versions/:id/comments` | `{ body, frame?, parentId? }` |
| `PATCH /v1/comments/:id` | `{ body }` – nur Verfasser oder Admin |
| `DELETE /v1/comments/:id` | weiches Löschen – nur Verfasser oder Admin |
| `POST/DELETE /v1/comments/:id/resolve` | erledigt setzen / wieder öffnen |

`frame` ist der Frame-Index im Video (0 = erstes Bild); fehlt er, ist es ein
allgemeiner Kommentar. Ein Frame hinter dem Videoende wird mit `400`
abgelehnt. Antworten erben keinen Frame und hängen immer am
Wurzelkommentar – Threads bleiben eine Ebene tief.

In der Antwort steht neben `frame` auch `timecode`: der SMPTE-Timecode
inklusive Start-Timecode der Kamera, in der Zählweise des Originals
(Drop-Frame, wo zutreffend).

Mentions im Text: `@[Anzeigename](benutzer-id)`. Der Server liest die IDs
heraus, prüft sie gegen aktive Konten und liefert sie als `mentions` zurück.

## Sonstiges

`GET /healthz` – ohne Anmeldung, für den Healthcheck in docker-compose.
