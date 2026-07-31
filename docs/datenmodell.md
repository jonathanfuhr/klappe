# Datenmodell

Quelle der Wahrheit ist `apps/api/src/db/schema.ts`; daraus werden die
SQL-Migrationen in `apps/api/drizzle/` erzeugt (`npm run db:generate`).

```
users
  └── projects ──┬── videos ── video_versions ──┬── comments ── comment_mentions
                 │                              └── uploads
                 ├── share_links ── share_link_grants
                 │        └── login_codes
                 ├── project_files
                 └── project_tags ── tags

app_settings   (Mailversand, Erscheinungsbild, Anmeldung – workspace-weit)
```

## users

Konten für Team und Gäste.

| Spalte | Anmerkung |
| --- | --- |
| `email` | immer kleingeschrieben gespeichert, eindeutig |
| `password_hash` | `null` bei Konten ohne lokales Passwort (Gäste, später M365) |
| `role` | `ADMIN` \| `MEMBER` \| `GUEST` |
| `is_active` | gesperrte Konten kommen sofort nicht mehr durch den Guard |
| `notifications_enabled` | steuert den Mailversand; der Abmeldelink setzt es auf `false` |

Der letzte aktive Administrator lässt sich weder herabstufen noch sperren.

Gastkonten entstehen beim ersten bestätigten Zugangscode. Sie haben kein
Passwort und sehen nur, was ihre Freigabe-Links hergeben.

## projects

Projekt im Workspace. `archived_at` markiert archivierte Projekte (Phase 18):
sichtbar und abspielbar, aber nur noch die neueste fertige Fassung je Video,
und kommentieren geht nicht mehr. Jeder Schreibzugriff im Projekt setzt
`updated_at` neu, damit die Projektliste nach zuletzt bearbeitet sortieren
kann.

## project_field_defs und project_field_values

Benutzerdefinierte Projekt-Felder (Phase 15): die Definitionen workspace-weit,
die Werte je Projekt (kein Eintrag = Feld dort leer, Kaskade beim Löschen der
Definition).

| Spalte | Anmerkung |
| --- | --- |
| `suggest` | Tippvorschläge aus den Werten der anderen Projekte (Phase 16) |
| `filterable`, `sortable`, `groupable` | steht das Feld in der Filterleiste bzw. der Sortier- und Gruppier-Auswahl der Projektliste (Phase 22)? Ab Werk an |
| `show_on_tile` | Wert auf der Projektkachel anzeigen (Phase 22)? Ab Werk aus |

`customer` ist der Kundenname. Er steht im Download-Dateinamen und dient dem
Upload-Fenster als Anhaltspunkt, welches Projekt zu einer Datei gehört.

## videos

Ein Video im Projekt, mit `sort_order` für eine spätere manuelle Reihenfolge.
Löschen kaskadiert auf Versionen, Uploads und Kommentare.

`downloads_enabled` ist der Schalter am Video – einer von dreien, die dem
Download eines Gastes zustimmen müssen.

`ai_content` ist die KI-Kennzeichnung nach Art. 50 EU AI Act (Phase 24,
Nachtrag). Sie hängt bewusst am Video, nicht an der Fassung – ob KI-Stimme
oder KI-Musik im Schnitt stecken, ändert sich nicht von v2 auf v3.

## ai_content_kinds und video_ai_kinds

Der Katalog der KI-Arten (ab Werk KI-Stimme, KI-Video, KI-Sounds, KI-Musik;
Name eindeutig über `lower(name)`, Reihenfolge per `sort_order`) und die
Zuordnung ans Video – aufgebaut wie `tags`/`project_tags`. Löschen einer Art
kaskadiert auf die Zuordnungen. Der globale Schalter dazu ist
`app_settings.ai_content_enabled`: Aus blendet Haken, Auswahl und Hinweis
überall aus, die Zuordnungen bleiben gespeichert.

## video_versions

Eine hochgeladene Fassung. **Kommentare hängen an der Version, nicht am
Video** – ein Kommentar auf Frame 812 meint immer eine bestimmte Fassung.

Die Nummer (`version_number`) ist pro Video eindeutig und fortlaufend ab 1;
der eindeutige Index fängt zwei gleichzeitige Uploads ab.

Statuskette:

```
UPLOADING ──► PROCESSING ──► READY
                   └──────► FAILED
```

Inhaltliche Gruppen:

- **Original** – `original_filename`, `original_size_bytes`, `original_key`.
  Downloads liefern immer diese Datei.
- **Aus `ffprobe`** – `duration_seconds`, `frame_count`, `fps_num`/`fps_den`
  (exakter Bruch, z. B. 30000/1001), `drop_frame`, `start_timecode` und
  `start_timecode_frames`, Auflösung, Codecs, `pixel_format`, `format_name`,
  Bitrate.
- **Aus der Pipeline** – `proxy_key` samt Maßen, `poster_key`, `sprite_key`
  mit Spalten, Zeilen, Kachelmaßen, Kachelzahl und Abstand.
- **Abspielweg** – `playback_mode` (`ORIGINAL` \| `REMUX` \| `TRANSCODE`) und
  `playback_reason`. Bei `ORIGINAL` zeigt `proxy_key` auf dieselbe Datei wie
  `original_key`; es liegt keine zweite Kopie herum.
- **Adaptive Wiedergabe** (Phase 13) – `hls_key` zeigt aufs Verzeichnis der
  Stufenleiter, `hls_variants` nennt die Stufen (`1080p,720p,480p`). Beide
  `null`, solange die Stufenleiter abgeschaltet ist; seit Phase 19 entsteht
  sie als eigener Auftrag und wird deshalb nachgetragen, nicht beim
  Fertigmelden gesetzt.
- **Verarbeitung** – `progress` (0–100), `processing_error`, Zeitstempel.
- **Ablage** – `download_enabled` (dritter Schalter für Gäste) und `file_date`
  (`JJJJ-MM-TT`), das Datum im Download-Dateinamen. Es kommt vom Upload und
  ist danach änderbar.

Warum die Framerate als Bruch: 29,97 ist in Wahrheit 30000/1001. Als
Dezimalzahl gespeichert liefe der Timecode nach einer Stunde um mehrere
Bilder daneben.

Warum `start_timecode_frames` zusätzlich zum Text: Die Anzeige im Player ist
`start_timecode_frames + frame`, umgerechnet in SMPTE. So sieht der Cutter
denselben Timecode wie in seinem Schnittprogramm.

## uploads

Laufende Upload-Sitzung nach tus-Semantik.

| Spalte | Anmerkung |
| --- | --- |
| `kind` | `VERSION` (neue Fassung) oder `PROJECT_FILE` (Kunden-Ablage) |
| `version_id` | bei `VERSION` schon beim Anlegen der Sitzung erzeugt, sonst `null` |
| `project_id` | bei `PROJECT_FILE` das Ziel, sonst `null` |
| `size_bytes` | angekündigte Gesamtgröße (`Upload-Length`) |
| `offset_bytes` | maßgeblicher Stand; wird gegen die Dateigröße abgeglichen |
| `storage_key` | `tmp/uploads/<id>.part`, nach Abschluss der endgültige Ort |
| `expires_at` | der stündliche Aufräumer entfernt abgelaufene Sitzungen |

## comments

| Spalte | Anmerkung |
| --- | --- |
| `frame` | Frame-Index im Video; `null` = allgemeiner Kommentar |
| `parent_id` | Antworten hängen immer am Wurzelkommentar (eine Ebene tief) |
| `resolved_at` / `resolved_by_id` | Erledigt-Status |
| `deleted_at` | weiches Löschen, damit Threads nicht auseinanderfallen |
| `edited_at` | gesetzt, sobald der Text geändert wurde |
| `annotation` | Zeichnung zum selben Frame, als JSON; `null` ohne Zeichnung |

Die Zeichnung liegt in **relativen** Koordinaten (0…1 der Bildbreite und
-höhe), die Strichstärke als Bruchteil der Höhe. Damit sitzt sie im Vollbild
genauso wie im kleinen Fenster und passt auch dann noch, wenn dieselbe Szene
später in anderer Auflösung hochgeladen wird. Format und Prüfung stehen in
`packages/shared/src/annotations.ts`.

Sortierung in der Liste: nach Frame aufsteigend, allgemeine Kommentare
zuletzt, bei gleichem Frame nach Zeitpunkt.

`author_id` verweist mit `on delete restrict` – Konten werden gesperrt, nicht
gelöscht, damit kein Kommentar seinen Verfasser verliert.

## comment_mentions

Zuordnung Kommentar → erwähnter Benutzer, Primärschlüssel über beide Spalten.

Im Text steht ein Mention als `@[Anna Meier](benutzer-id)`. Der Vorteil
gegenüber einem bloßen `@anna`: Die Zuordnung bleibt eindeutig, auch wenn
zwei Personen gleich heißen oder jemand später umbenannt wird. Beim Speichern
werden die IDs aus dem Text gelesen und gegen aktive Konten geprüft; nur diese
landen in der Tabelle. Sie entscheidet auch, wer benachrichtigt wird.

## share_links

Ein Freigabe-Link auf ein Projekt oder auf ein einzelnes Video.

| Spalte | Anmerkung |
| --- | --- |
| `token` | 24 Zeichen ohne `0`, `o`, `1`, `l`; eindeutig, am Telefon vorlesbar |
| `scope` | `PROJECT` (alle Videos, auch spätere) oder `VIDEO` (genau eines) |
| `project_id` / `video_id` | je nach `scope` gesetzt |
| `allow_comments` / `allow_download` / `allow_upload` | Rechte des Links |
| `expires_at` | optionales Ablaufdatum |
| `revoked_at` | Entzug; wirkt sofort, weil die Rechte pro Anfrage geladen werden |

Hochladen gibt es nur bei `PROJECT`: Der Kunden-Ordner hängt am Projekt, ein
einzelnes Video hat keinen.

Der Link allein reicht nicht: Er führt zum Zugangsgatter, nicht zum Video.

## login_codes

Sechsstellige Zugangscodes zu einem Link.

| Spalte | Anmerkung |
| --- | --- |
| `code_hash` | nur der Hash liegt in der Datenbank |
| `attempts` | nach fünf Fehlversuchen ist der Code verbrannt |
| `expires_at` | 15 Minuten |
| `consumed_at` | ein Code gilt genau einmal |

Fünf Codes je Stunde und E-Mail-Adresse. Adressen von Team-Konten werden
abgewiesen – die sollen sich anmelden.

## share_link_grants

Wer über welchen Link hereingekommen ist: Zuordnung Gastkonto → Link, mit
Zeitpunkt und Anzeigename. Aus dieser Tabelle baut der `AccessService` bei
jeder Anfrage die Rechte des Gastes zusammen.

| Spalte | Anmerkung |
| --- | --- |
| `allow_comments`, `allow_download`, `allow_upload` | Rechte-Ausnahmen je Person (Phase 16); `null` heißt „wie der Link" |
| `project_admin` | „Externer Projektadmin" (Phase 21): darf im Projekt Videos anlegen, Fassungen hochladen und löschen, weiter freigeben und fremde Kommentare verwalten. Nur an einer Projektfreigabe wirksam, nie nullbar – immer eine ausdrückliche Entscheidung |
| `revoked_at` | Entzug für genau diese Person; der Link bleibt für andere gültig |

## project_files

Die Kunden-Ablage je Projekt – Briefings, Logos, Schnittfassungen. Neben
Name, Größe, Typ und Schlüssel steht hier, wer die Datei hochgeladen hat und
über welchen Link. Gäste sehen nur ihre eigenen Dateien, das Team sieht alle;
löschen darf nur das Team.

## tags und project_tags

Schlagworte für Projekte (Phase 12), workspace-weit statt pro Projekt – der
Sinn eines Tags ist ja gerade, mehrere Projekte zusammenzufassen.

| Spalte | Anmerkung |
| --- | --- |
| `name` | eindeutig ohne Rücksicht auf Groß- und Kleinschreibung (Index über `lower(name)`) |
| `color` | Hex-Farbe; `null` heißt: aus dem Namen ableiten |

`project_tags` ist die Zuordnung, Primärschlüssel über beide Spalten. Löschen
eines Schlagworts entfernt es per Kaskade auch an allen Projekten.

## app_settings

Workspace-weite Einstellungen – genau eine Zeile. Drei Gruppen:

- **Mailversand** (Phase 8): Host, Port, TLS, Benutzer, Absender. Das Passwort
  liegt mit AES-256-GCM verschlüsselt darin (`v1.<nonce>.<ct>.<tag>`), der
  Schlüssel wird aus `JWT_SECRET` abgeleitet. Die API gibt es nie heraus, sie
  meldet nur, ob eines gesetzt ist. `smtp_auth_method` wählt zwischen
  `password` und `oauth2`; bei `oauth2` stehen `smtp_oauth_tenant_id` und
  `smtp_oauth_client_id` dazu, das Client-Secret liegt genauso verschlüsselt
  in `smtp_oauth_client_secret_encrypted`. Nötig für Microsoft 365, sobald der
  Tenant Mehrfaktor-Anmeldung erzwingt – dann lehnt der Server ein Kennwort ab.
- **Erscheinungsbild** (Phase 10): `brand_title`, `brand_accent` und die
  Angaben zum Logo. Aus der einen Farbe werden Hover-Ton und Schriftfarbe
  berechnet, nicht gespeichert. `brand_logo_updated_at` wandert in die
  Bild-Adresse und bricht damit den Browser-Cache auf.
- **Tab-Symbol und App-Symbol** (Phase 23, vereinfacht in 24):
  `favicon_key` / `favicon_mime` / `favicon_updated_at` für die hochgeladene
  `.ico` und `app_icon_key` / `app_icon_updated_at` für das quadratische PNG
  auf dem Startbildschirm – beide wie beim Logo. Bis Phase 24 stand daneben ein
  `favicon_mode`, mit dem sich das Symbol aus dem Logo ableiten ließ; das
  Ergebnis passte selten, die Spalte ist mit Migration 0035 entfallen.
- **Datenbanksicherung** (Phase 23): `backup_enabled`, `backup_interval_hours`
  (Vorgabe 24), `backup_retention_days` (Vorgabe 30), dazu `backup_last_run_at`
  und `backup_last_error`. Der Zeitpunkt wird nur bei Erfolg fortgeschrieben –
  sonst gälte ein gescheiterter Lauf als erledigt.
- **Anmeldung** (Phase 11): `local_login_enabled`, `oidc_*`. Das
  Client-Secret liegt wie das SMTP-Passwort verschlüsselt darin.
  `oidc_auto_provision` steht standardmäßig auf `false` – ohne diesen Schalter
  kommt über M365 nur herein, wer hier schon ein Konto hat.
- **Verarbeitung** (Phase 19): `download_formats_enabled`,
  `download_prebuild`, `download_final_only` und das Zeitfenster
  (`transcode_window_start` / `_end`, Minuten seit Mitternacht; Start hinter
  dem Ende meint die Nacht). Dazu `hls_enabled`, `proxy_short_edge`,
  `proxy_video_bitrate_kbps` und `proxy_preset` – diese vier sind **nullbar**:
  `null` heißt „in der Oberfläche nie entschieden, nimm den Wert aus der
  `.env`". So läuft eine bestehende Anlage unverändert weiter, und der erste
  Klick übernimmt die Hoheit.

## download_presets

Die Formate, die beim Herunterladen zur Auswahl stehen (Phase 19). Angelegt
werden sie nur vom Admin; wer herunterlädt, sieht Name und Größe, nicht
Bitrate und Preset. `short_edge` ist wie überall die **kurze** Kante.
`is_active` nimmt ein Format aus der Auswahl, ohne die schon erzeugten
Dateien wegzuwerfen – dafür ist das Löschen da. Der eindeutige Index liegt auf
`lower(name)`.

## version_renditions

Eine erzeugte Download-Fassung: ein Preset, angewendet auf eine Version
(Phase 19). Eindeutig je (`version_id`, `preset_id`), beide Fremdschlüssel mit
`on delete cascade`.

`signature` hält fest, mit welchen Werten die Datei entstanden ist (kurze
Kante, Bitraten, Preset, Container). Ändert der Admin das Format, passt die
Unterschrift nicht mehr, und die Fassung gilt wieder als nicht erzeugt – statt
still eine Datei auszuliefern, die mit dem gewählten Format nichts mehr zu tun
hat. Der Name steht bewusst **nicht** in der Unterschrift: Ein Umbenennen soll
keine fertigen Dateien wegwerfen.

`requested_by_id` ist `null`, wenn die Datei aus der Vorab-Erzeugung stammt und
nicht auf Klick.
