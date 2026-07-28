# Datenmodell

Quelle der Wahrheit ist `apps/api/src/db/schema.ts`; daraus werden die
SQL-Migrationen in `apps/api/drizzle/` erzeugt (`npm run db:generate`).

```
users
  └── projects ──┬── videos ── video_versions ──┬── comments ── comment_mentions
                 │                              └── uploads
```

## users

Konten für Team und (später) Gäste.

| Spalte | Anmerkung |
| --- | --- |
| `email` | immer kleingeschrieben gespeichert, eindeutig |
| `password_hash` | `null` bei Konten ohne lokales Passwort (später Gäste, M365) |
| `role` | `ADMIN` \| `MEMBER` \| `GUEST` |
| `is_active` | gesperrte Konten kommen sofort nicht mehr durch den Guard |
| `notifications_enabled` | vorbereitet für Phase 8 |

Der letzte aktive Administrator lässt sich weder herabstufen noch sperren.

## projects

Projekt im Workspace. `archived_at` ist vorbereitet, aber noch ohne
Oberfläche. Jeder Schreibzugriff im Projekt setzt `updated_at` neu, damit die
Projektliste nach zuletzt bearbeitet sortieren kann.

## videos

Ein Video im Projekt, mit `sort_order` für eine spätere manuelle Reihenfolge.
Löschen kaskadiert auf Versionen, Uploads und Kommentare.

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
  `start_timecode_frames`, Auflösung, Codecs, Bitrate.
- **Aus der Pipeline** – `proxy_key` samt Maßen, `poster_key`, `sprite_key`
  mit Spalten, Zeilen, Kachelmaßen, Kachelzahl und Abstand.
- **Verarbeitung** – `progress` (0–100), `processing_error`, Zeitstempel.

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
| `version_id` | die Version entsteht schon beim Anlegen der Sitzung |
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
landen in der Tabelle. Grundlage für die Benachrichtigungen in Phase 8.
