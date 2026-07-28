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
| `POST /v1/projects` | `{ name, customer?, description? }` |
| `GET/PATCH/DELETE /v1/projects/:id` | einzeln |
| `GET /v1/projects/:id/videos` | Videos mit jeweils neuester Version |
| `POST /v1/projects/:id/videos` | `{ name, description? }` |
| `GET/PATCH/DELETE /v1/videos/:id` | einzeln; `PATCH` kennt `downloadsEnabled` |
| `GET /v1/videos/:id/versions` | alle Versionen, neueste zuerst |
| `GET/PATCH/DELETE /v1/versions/:id` | einzeln; die letzte Version eines Videos lässt sich nicht löschen |

`PATCH /v1/versions/:id` nimmt `{ label?, downloadEnabled?, fileDate? }`.
`fileDate` steht als `JJJJ-MM-TT` und bestimmt das `JJMMTT` im
Download-Dateinamen.

Gäste sehen nur, was ihr Freigabe-Link hergibt. Fehlt der Zugriff, antwortet
die API mit **404** statt 403 – ein 403 würde verraten, dass es die ID gibt.

An jeder Version stehen zusätzlich:

| Feld | Bedeutung |
| --- | --- |
| `playbackMode` | `ORIGINAL` \| `REMUX` \| `TRANSCODE` – wie die Abspielfassung entstand |
| `playbackReason` | Begründung im Klartext |
| `canDownload` | ob **dieser** Aufrufer das Original bekommt |
| `fileDate` | `JJMMTT` |
| `downloadFilename` | der fertige Name, z. B. `260304_THD_Kampagne_Teaser_v1_1080p25.mov` |

## Upload (tus 1.0.0)

Unterstützt: Core, Creation, Termination.

```
POST /v1/videos/:videoId/uploads          neue Fassung (nur Team)
POST /v1/projects/:projectId/uploads      Kunden-Ablage (auch Gäste mit Recht)
  Upload-Length: 42949672960
  Upload-Metadata: filename <base64>,filetype <base64>
  — oder als JSON: { filename, sizeBytes, mimeType?, label?, fileDate? }
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
| `GET/HEAD /v1/versions/:id/proxy` | Abspielfassung, mit `Range`-Unterstützung (206) |
| `GET/HEAD /v1/versions/:id/original` | **immer die Originaldatei**; `?inline=1` unterdrückt den Download-Header |
| `GET /v1/versions/:id/poster` | Posterframe (JPEG) |
| `GET /v1/versions/:id/sprite` | Kachelbild für die Timeline-Vorschau (JPEG) |

Ein unerfüllbarer `Range` ergibt `416` mit `Content-Range: bytes */<größe>`.
Poster und Sprite ändern sich nie und werden entsprechend lange
zwischengespeichert.

Das Original kommt unter dem vereinbarten Namen (`Content-Disposition`), nicht
unter dem, den Kamera oder Schnittprogramm vergeben haben. Damit ein Gast es
überhaupt bekommt, müssen **drei** Schalter zustimmen: das Recht am
Freigabe-Link, `downloadsEnabled` am Video und `downloadEnabled` an der
Fassung. Fürs Team gilt keiner davon.

Die Kachel zu einem Zeitpunkt: `index = floor(sekunden / intervalSeconds)`,
begrenzt auf `tileCount - 1`; daraus `spalte = index % columns` und
`zeile = floor(index / columns)`.

## Kommentare

| Route | Zweck |
| --- | --- |
| `GET /v1/versions/:id/comments` | Wurzelkommentare mit ihren Antworten |
| `POST /v1/versions/:id/comments` | `{ body, frame?, parentId?, annotation? }` |
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

`annotation` ist die Zeichnung zum selben Frame, in relativen Koordinaten
(0…1 der Bildbreite und -höhe):

```json
{
  "version": 1,
  "strokes": [
    { "color": "#ff3b30", "width": 0.004, "points": [{ "x": 0.21, "y": 0.44 }] }
  ]
}
```

Zu große oder krumme Werte werden nicht abgelehnt, sondern begradigt
(geklemmt auf 0…1, höchstens 60 Striche mit je 600 Punkten). Eine leere
Zeichnung wird als „keine“ gespeichert.

## Freigaben und Gastzugang

| Route | Zweck |
| --- | --- |
| `GET /v1/projects/:projectId/shares` | Links auf dieses Projekt (Team) |
| `GET /v1/videos/:videoId/shares` | Links, über die dieses Video sichtbar ist |
| `POST /v1/shares` | `{ scope, projectId?, videoId?, label?, allowComments?, allowDownload?, allowUpload?, expiresAt? }` |
| `PATCH /v1/shares/:id` | `{ label?, allowComments?, allowDownload?, allowUpload?, expiresAt?, revoked? }` |
| `DELETE /v1/shares/:id` | entziehen – wirkt sofort |
| `GET /v1/shares/:id/guests` | wer über den Link hereingekommen ist |
| `DELETE /v1/shares/:id/guests/:userId` | einzelnem Gast den Zugang entziehen |
| `POST /v1/shares/:id/guests/:userId` | Entzug zurücknehmen |

`scope` ist `PROJECT` (ganzes Projekt, `projectId` nötig) oder `VIDEO`
(genau ein Video, `videoId` nötig). Hochladen in die Kunden-Ablage geht nur
mit `PROJECT`-Freigaben – ein einzelnes Video hat keinen Ordner.

Ohne Anmeldung erreichbar (`@Public()`):

| Route | Zweck |
| --- | --- |
| `GET /v1/share/:token` | Vorschau: Projektname, Rechte, ob der Link noch gilt |
| `POST /v1/share/:token/code` | `{ email, name? }` → schickt einen sechsstelligen Code |
| `POST /v1/share/:token/verify` | `{ email, code }` → setzt das Sitzungs-Cookie des Gastes |

Fünf Fehlversuche je Code, fünf Codes je Stunde und Adresse (`429`).
Team-Adressen werden mit `409` abgewiesen – die sollen sich anmelden.

## Kunden-Ablage

| Route | Zweck |
| --- | --- |
| `GET /v1/projects/:projectId/files` | Gäste sehen nur ihre eigenen Dateien, das Team alle |
| `GET /v1/project-files/:id/download` | Auslieferung mit `Range` |
| `DELETE /v1/project-files/:id` | nur Team |

Hochgeladen wird über `POST /v1/projects/:projectId/uploads` (siehe oben).

## E-Mail

| Route | Rolle |
| --- | --- |
| `GET /v1/settings/mail-status` | ohne Anmeldung – nur `{ ready }`, damit die Anmeldeseite weiß, ob Codes verschickt werden können |
| `GET /v1/settings/smtp` | Admin – Einstellungen ohne Passwort, dafür `hasPassword` |
| `PUT /v1/settings/smtp` | Admin – `{ enabled, preset, host, port, secure, user, password?, fromName, fromAddress }` |
| `POST /v1/settings/smtp/test` | Admin – Testmail an die eigene Adresse |
| `GET /v1/settings/smtp/presets` | Admin – Vorlagen (Brevo, Mailgun, Postmark, SES, Microsoft 365) |

Das Passwort wird verschlüsselt gespeichert und nie wieder herausgegeben; ohne
`password` im Rumpf bleibt das gespeicherte bestehen.

Benachrichtigt wird bei @-Mention und bei Antworten im eigenen Thread, nie an
den Verfasser selbst und nie an Konten mit abgeschalteten Benachrichtigungen.

Jede Mail trägt in der Fußzeile einen Abmeldelink auf `/abmelden?token=…` mit
einem HMAC-signierten Token. Die Seite ruft `POST /v1/unsubscribe`
(`{ token }`, ohne Anmeldung) auf – wer keine Mails mehr will, soll sich dafür
nicht erst einloggen müssen.

## Sonstiges

`GET /healthz` – ohne Anmeldung, für den Healthcheck in docker-compose.
