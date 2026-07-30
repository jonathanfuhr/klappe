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

Passwörter: mindestens 10 Zeichen, Buchstaben und Ziffern. Ein Gast lässt
sich über `role` **nicht** ins Team heben (Phase 21) – Gäste melden sich per
Code an, das Team mit Passwort oder Microsoft 365; für einen Kollegen entsteht
ein eigenes Konto.

## Projekte und Videos

| Route | Zweck |
| --- | --- |
| `GET /v1/projects` | Liste; Filter `?tags=<id,id>&tagMatch=any\|all`, Sortierung `?sort=updated\|created\|name` |
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
| `downloadFilename` | der fertige Name, z. B. `260304_Beispiel_Kampagne_Teaser_v1_1080p25.mov` |

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

Anlegen und Einsehen dürfen seit Phase 21 auch **externe Projektadmins** für
ihr eigenes Projekt; Ändern, Löschen und die Gäste eines Links bleiben dem
Team vorbehalten.

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
| `GET /v1/settings/smtp` | Admin – Einstellungen ohne Passwort/Secret, dafür `hasPassword`/`hasOauthClientSecret` |
| `PUT /v1/settings/smtp` | Admin – `{ enabled, preset, host, port, secure, authMethod, user, password?, oauthTenantId?, oauthClientId?, oauthClientSecret?, fromName, fromAddress }` |
| `POST /v1/settings/smtp/test` | Admin – Testmail an die eigene Adresse |
| `GET /v1/settings/smtp/presets` | Admin – Vorlagen (Brevo, Mailgun, Postmark, SES, Microsoft 365) |

`authMethod` ist `password` (SMTP AUTH mit Benutzername und Kennwort) oder
`oauth2` (Client-Credentials-Fluss gegen Entra ID – nötig für Microsoft 365,
sobald der Tenant Mehrfaktor-Anmeldung erzwingt). Das Passwort bzw. Client-Secret
wird verschlüsselt gespeichert und nie wieder herausgegeben; ohne `password`
bzw. `oauthClientSecret` im Rumpf bleibt das gespeicherte bestehen.

Benachrichtigt wird bei @-Mention und bei Antworten im eigenen Thread, nie an
den Verfasser selbst und nie an Konten mit abgeschalteten Benachrichtigungen.

Jede Mail trägt in der Fußzeile einen Abmeldelink auf `/abmelden?token=…` mit
einem HMAC-signierten Token. Die Seite ruft `POST /v1/unsubscribe`
(`{ token }`, ohne Anmeldung) auf – wer keine Mails mehr will, soll sich dafür
nicht erst einloggen müssen.

## Gäste- und Rechteübersicht (Phase 9)

Alles hier ist dem Team vorbehalten – ein Gast soll nicht sehen, wer sonst
noch am Projekt sitzt.

| Route | Zweck |
| --- | --- |
| `GET /v1/projects/:projectId/guests` | wer das Projekt erreicht, über welche Links, mit welchen Rechten |
| `GET /v1/videos/:videoId/guests` | dasselbe fürs Video – auch die über die Projektfreigabe |
| `GET /v1/guests` | alle Gastkonten des Workspace mit ihren Projekten |
| `DELETE /v1/projects/:projectId/guests/:userId` | diesem Gast das ganze Projekt entziehen |
| `POST /v1/projects/:projectId/guests/:userId` | Entzug zurücknehmen |
| `PATCH /v1/guests/:userId` | Admin – `{ isActive }`, sperrt das Konto workspace-weit |

Der Entzug gilt für **diese eine Person** an allen Links ins Projekt; der Link
selbst bleibt für die anderen bestehen. `canView` / `canComment` /
`canDownload` / `canUpload` / `isProjectAdmin` in der Antwort sind die Summe
über alle gültigen Links – ein Link zählt nur mit, wenn er selbst gilt, dem
Gast nicht entzogen wurde und das Konto nicht gesperrt ist.

Über `PATCH /v1/shares/:shareLinkId/guests/:userId/rechte` setzt das Team
Rechte je Person (`{ allowComments?, allowDownload?, allowUpload?,
projectAdmin? }`; `null` heißt „wie der Link"). `projectAdmin` – der
**Externe Projektadmin** (Phase 21) – geht nur an einer Projektfreigabe und
erlaubt dem Gast in diesem Projekt: Videos anlegen, Fassungen hochladen und
löschen, Freigabe-Links anlegen und einsehen, fremde Kommentare bearbeiten
und löschen.

## Erscheinungsbild (Phase 10)

| Route | Zweck |
| --- | --- |
| `GET /v1/branding` | ohne Anmeldung – Titel, Farben, Logo-Adresse |
| `GET /v1/branding/logo` | ohne Anmeldung – die Logodatei |
| `PUT /v1/settings/branding` | Admin – `{ title?, accent? }` |
| `PUT /v1/settings/branding/logo` | Admin – rohe Bytes, Format im `Content-Type` |
| `DELETE /v1/settings/branding/logo` | Admin |

Gesetzt wird **eine** Farbe; `accentHover` und `accentContrast` werden daraus
berechnet. Als Logo gehen PNG, JPEG, WebP und SVG bis 512 KB. Die Logo-Adresse
trägt einen Zeitstempel, damit ein Wechsel sofort sichtbar wird.

## Anmeldung (Phase 11)

| Route | Zweck |
| --- | --- |
| `GET /v1/auth/methods` | ohne Anmeldung – `{ local, microsoft, microsoftLabel }` |
| `GET /v1/auth/microsoft/start` | ohne Anmeldung – Weiterleitung zu Entra ID; `?redirect=` bleibt auf eigene Pfade beschränkt |
| `GET /v1/auth/microsoft/callback` | ohne Anmeldung – Rückkehr, setzt das Sitzungs-Cookie |
| `GET /v1/settings/auth` | Admin – Einstellungen ohne Secret, dafür `hasClientSecret` und die einzutragende `redirectUri` |
| `PUT /v1/settings/auth` | Admin – `{ localLoginEnabled?, oidcEnabled?, tenantId?, clientId?, clientSecret?, autoProvision?, allowedDomains?, buttonLabel? }` |

Beide M365-Routen sind Weiterleitungen im Browser, keine JSON-Schnittstelle.
Geht etwas schief, landet der Benutzer auf `/login?fehler=<Begründung>` –
inklusive der Meldung, die Microsoft geliefert hat.

`PUT /v1/settings/auth` weist mit `400` ab, wenn die lokale Anmeldung
abgeschaltet werden soll, ohne dass Microsoft 365 aktiv und vollständig
eingerichtet ist. Ist beides ausgeschaltet, weil die M365-Einrichtung später
zerfallen ist, lebt die lokale Anmeldung automatisch wieder auf.

## Schlagworte (Phase 12)

| Route | Zweck |
| --- | --- |
| `GET /v1/tags` | alle Schlagworte mit Projektzahl |
| `POST /v1/tags` | `{ name, color? }` – ohne Farbe wird eine aus dem Namen abgeleitet |
| `PATCH /v1/tags/:id` | `{ name?, color? }`; leere Farbe heißt „wieder ableiten" |
| `DELETE /v1/tags/:id` | verschwindet auch an allen Projekten |
| `PUT /v1/projects/:projectId/tags` | `{ tagIds }` – setzt genau diese Liste |
| `POST/DELETE /v1/projects/:projectId/tags/:tagId` | einzeln an- und abhängen |

Namen sind eindeutig ohne Rücksicht auf die Schreibweise; ein Duplikat ergibt
`409`.

## Adaptive Wiedergabe und Medien-Links (Phase 13)

| Route | Zweck |
| --- | --- |
| `GET /v1/versions/:id/hls/master.m3u8` | Master-Playlist, falls eine Leiter erzeugt wurde |
| `GET /v1/versions/:id/hls/:variant/:file` | Stufen-Playlist und Segmente |
| `GET /v1/versions/:id/media-links` | kurzlebige Adressen für Proxy, Poster, Streifen und (mit Recht) Original |

Die HLS-Leiter entsteht nur, wenn sie unter **Einstellungen → Transcode**
eingeschaltet ist (Phase 19; ohne Entscheidung dort gilt `HLS_ENABLED` aus der
`.env`). Sie läuft als eigener Auftrag mit niedrigem Vorrang, die Fassung ist
also schon `READY`, bevor `hlsVariants` gefüllt ist. `hlsVariants` an der
Fassung nennt die vorhandenen Stufen. Dateinamen unterhalb von `hls/` werden
streng geprüft, Stufen müssen in `hlsVariants` stehen.

Die Links aus `media-links` tragen einen signierten Token in `?t=`, der an
Fassung, Art und Person gebunden ist und nach sechs Stunden verfällt. Er
**ersetzt die Rechteprüfung nicht** – ein entzogener Zugang macht auch einen
schon vergebenen Link wertlos. Ein Token für den Proxy schaltet das Original
nicht frei.

## Speicher (Phase 22)

| Route | Zweck |
| --- | --- |
| `GET /v1/settings/storage` | Admin – freier Platz und was Klappe belegt |

`totalBytes` / `freeBytes` / `usedBytes` kommen aus `statfs` und gelten für das
ganze Dateisystem hinter `STORAGE_DIR`; `freeBytes` ist `bavail`, also ohne die
für root reservierten Blöcke – belegt und frei ergeben zusammen deshalb etwas
weniger als die Gesamtgröße, genau wie bei `df`. Gibt das Betriebssystem keine
Auskunft, steht `available: false` und die drei Größen sind `null`.

`usage` summiert dagegen aus der Datenbank, was **Klappe** belegt (Originale,
Abspielfassungen, Download-Formate, Kundenmaterial, angefangene Uploads).
Posterframes, Sprite-Streifen und HLS-Segmente führt Klappe ohne Größe und
fehlen darin – die Summe ist eine Untergrenze.

## Verarbeitung und Download-Formate (Phase 19)

| Route | Zweck |
| --- | --- |
| `GET /v1/settings/transcode` | Einstellungen samt Formaten (nur Admin) |
| `PUT /v1/settings/transcode` | Schalter, Zeitfenster, HLS, Werte der Abspielfassung |
| `POST /v1/settings/transcode/presets` | Format anlegen |
| `PATCH /v1/settings/transcode/presets/:id` | Format ändern |
| `DELETE /v1/settings/transcode/presets/:id` | Format samt erzeugter Dateien löschen |
| `GET /v1/versions/:id/downloads` | was das Download-Fenster anbietet |
| `POST /v1/versions/:id/downloads/:presetId` | Format anfordern |
| `GET /v1/versions/:id/downloads/:presetId/datei` | die fertige Datei |

Die Auskunft nennt `formatsEnabled`; ist sie `false`, kommt die Liste leer
zurück und der Knopf lädt wie bisher direkt das Original. `POST` antwortet mit
dem Stand des Formats (`QUEUED`, `PROCESSING`, `READY`, `FAILED`); ist es
schon fertig und passt es noch zum Preset, kommt es unverändert zurück, ohne
einen zweiten ffmpeg-Lauf.

`…/datei` liefert `404`, solange die Fassung noch entsteht – lieber das als
eine halbe Datei. Die Rechteprüfung ist dieselbe wie beim Original: Ein Format
ist ein Download, kein Nebeneingang. Ausgeliefert wird mit `Range`-Unter­stützung
und unter dem gewohnten Dateinamen, dessen Auflösungsangabe die des Formats
nennt (`…_v1_720p25.mp4`), nicht die des Originals.

Zeiten stehen als `HH:MM`; ein leerer String löscht das Zeitfenster. Beide
Zeiten müssen gesetzt oder beide leer sein.

## Anfragebremsen

An den empfindlichen Routen zählt eine Bremse in einem gleitenden Fenster.
Wird sie ausgelöst, kommt `429` mit `Retry-After`; `X-RateLimit-Limit` und
`X-RateLimit-Remaining` stehen an jeder Antwort.

| Route | Grenze |
| --- | --- |
| `POST /v1/auth/login` | 10 je Adresse und Minute |
| `POST /v1/auth/password` | 10 je Minute |
| `POST /v1/share/:token/code` | 12 je Stunde (zusätzlich zu 5 je Adresse im Dienst) |
| `POST /v1/share/:token/verify` | 20 je Adresse und Stunde |
| `POST /v1/unsubscribe` | 20 je Stunde |
| `GET /v1/auth/microsoft/start` | 30 je Stunde |

Abgelehnte Versuche zählen nicht mit – sonst könnte sich jemand durch stures
Weiterklopfen selbst dauerhaft aussperren.

## Sonstiges

`GET /healthz` – ohne Anmeldung, für den Healthcheck in docker-compose.
