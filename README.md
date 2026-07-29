# Klappe

Selbst gehostetes Review- und Freigabe-Werkzeug für Videoproduktionen – die
eigene Alternative zu Frame.io.

Schnittfassungen hochladen, frame-genau ansehen, am Bild kommentieren und
zeichnen, per Link an Kunden freigeben, Rückmeldungen einsammeln, freigeben,
herunterladen. Alles läuft im eigenen Docker-Stack: keine fremde Cloud, kein
Abo pro Kopf, und das Kameramaterial verlässt das Haus nicht.

Ein Container-Stack trägt genau **einen Workspace** mit eigenem Logo, Titel und
eigener Farbe. Wer zwei Firmen strikt trennen will, betreibt zwei Stapel.

**Stand: Phasen 0–19 sind gebaut, geprüft und im Einsatz.** Der grobe Umfang
steht unten unter [Umgesetzte Phasen](#umgesetzte-phasen).

---

## Inhalt

- [Module](#module)
- [Was das Tool kann](#was-das-tool-kann)
- [Installation](#installation)
- [HTTPS](#https)
- [Einstellungen](#einstellungen)
- [Eingebetteter Player](#eingebetteter-player)
- [Betrieb](#betrieb)
- [Entwicklung](#entwicklung)
- [Umgesetzte Phasen](#umgesetzte-phasen)

---

## Module

```
                        Browser
                           │  HTTPS, eine einzige Herkunft
                           ▼
                       ┌───────┐
                       │ caddy │   einziger Port nach außen
                       └───┬───┘
              /v1/* ───────┴─────── alles andere
                ▼                        ▼
            ┌───────┐                ┌───────┐
            │  api  │                │  web  │
            │ Nest  │                │ Next  │
            └───┬───┘                └───────┘
                │  Auftrag einreihen
                ▼
            ┌───────┐   abholen    ┌────────┐
            │ redis │ ───────────► │ worker │
            │BullMQ │              │ ffmpeg │
            └───────┘              └────────┘

     api und worker teilen sich  postgres  und das Volume  /data
```

| Dienst | Aufgabe |
| --- | --- |
| `caddy` | Reverse Proxy, einziger Port nach außen. Verteilt `/v1/*` an die API, alles andere an die Oberfläche. Optional holt er auch das TLS-Zertifikat. |
| `web` | Next.js: Oberfläche, Player, Kommentare, Upload-Fenster, Einstellungen. |
| `api` | NestJS: Rechte, Projekte, Kommentare, Freigaben, Upload-Annahme. Reiht Aufträge nur ein. |
| `worker` | Derselbe Code, anderes Kommando. Führt ffmpeg aus und verschickt Mails – getrennt, damit ein 4K-Transcode die Oberfläche nicht ausbremst. |
| `postgres` | Alles außer den Mediendateien. |
| `redis` | Warteschlangen und der Ereignisstrom für die Live-Aktualisierung. |
| Volume `/data` | Originale, Abspielfassungen, Posterframes, Sprite-Streifen, Download-Formate, Kunden-Dateien. **Das gehört in die Sicherung.** |

API und Worker starten aus **einem** Image. Damit ist ausgeschlossen, dass der
Worker mit anderem Code läuft als die API – ein Fehler, der sich sonst erst
beim nächsten Transcoding zeigt.

**Warum Caddy Pflicht ist:** Next.js kann `/v1/*` selbst weiterleiten, tut das
aber über einen Weg, der `Connection: close` erzwingt. Safari bricht damit
mitten im Upload ab. Caddy reicht die Blöcke sauber durch und gibt Antworten
ungepuffert weiter – ohne das stockt außerdem das Video und der Ereignisstrom
kommt nie an. Details in `docker/klappe-routen.caddy`.

---

## Was das Tool kann

### Projekte, Videos, Versionen

Die Hierarchie ist **Projekt → Video → Fassung**. Ein Video trägt beliebig
viele Fassungen; Versionsnummern sind frei wählbar, auch eine `v2.5` zwischen
`v2` und `v3` – nur doppelt darf keine sein, und rückwärts geht es nicht.

Ein Haken **Endfassung** trennt Zwischenstand von Fertigem. Ohne ihn sieht der
Kunde einen Hinweis, und der Dateiname trägt `Vorschau`.

Projekte tragen einen Kunden und beliebige **benutzerdefinierte Felder** (etwa
eine Projektnummer), die in den Einstellungen angelegt werden. Nach jedem Feld
lässt sich filtern, sortieren und gruppieren – Kunde und Schlagworte sind dabei
ganz normale Dimensionen, keine Sonderfälle.

Projekte lassen sich **archivieren**: Sie bleiben sichtbar und abspielbar,
zeigen je Video aber nur noch die neueste fertige Fassung, und kommentieren
geht nicht mehr. Die älteren Fassungen bleiben eine einstellbare Frist liegen
(Standard 30 Tage) und werden dann weggeräumt; die neueste bleibt immer.
Zurückholen macht alles rückgängig, was noch da ist.

### Hochladen

Ein zentrales Upload-Fenster nimmt beliebig viele Dateien auf einmal – auch
ganze Ordner. Es lässt sich zuklappen (dann bleibt eine schmale Leiste unten
rechts) und läuft beim Seitenwechsel weiter.

Übertragen wird in Blöcken nach **tus 1.0.0**: Bricht die Verbindung ab, geht
es an genau der Stelle weiter. Ein 40-GB-Kameraband über VPN ist damit kein
Problem, und die Liste übersteht sogar einen Seiten-Reload.

Aus dem Dateinamen werden Projekt, Video und Versionsnummer **vorgeschlagen**
(`V1`, `V01`, `version 2`, Kunden- und Projektnamen) – jeder Vorschlag trägt
sichtbar den Zusatz *bitte prüfen*. Angelegt wird erst, wenn jemand auf
**Speichern** klickt; bis dahin taucht die Datei nirgends auf.

Die Verarbeitung läuft parallel zur Eingabe: Sie startet, sobald der letzte
Block da ist, noch bevor Projekt und Video feststehen. Wer danach speichert,
bekommt das fertige Ergebnis in Millisekunden statt eines zweiten
ffmpeg-Laufs.

Fortschritt gibt es zweimal, weil es zwei Wartezeiten sind: Hochladen und
Verarbeiten.

### Player und Kommentare

Frame-genaue Wiedergabe über `requestVideoFrameCallback`, mit Live-Timecode und
Frame-Zähler. Der Proxy trägt exakt die Framerate des Originals – Frame 812 im
Player ist Frame 812 im Schnittprogramm.

Kommentare hängen an einem **Frame**, nicht an einer Sekunde, mit Antworten,
@-Mentions, Erledigt-Status und Markern auf der Timeline. Sortiert wird nach
Timecode oder Erstellung.

Dazu ein **Zeichenwerkzeug**: freihändige Striche in mehreren Farben auf dem
Standbild, an denselben Frame geheftet wie der Kommentar. Die Koordinaten sind
relativ, also unabhängig von Fenster- und Videogröße.

Am Telefon im Querformat läuft der Player im passenden Layout; wird es eng,
weicht die Frame-Nummer und der Timecode bleibt.

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

### Freigaben und Gäste

Freigegeben wird per Link, auf ein **Projekt** oder ein einzelnes **Video**.
Gäste brauchen kein Konto: Sie geben Name und E-Mail an und bekommen einen
sechsstelligen Code per Mail. Je Link ist einstellbar, ob kommentiert,
heruntergeladen und hochgeladen werden darf; abweichende Rechte lassen sich
zusätzlich **pro Person** setzen.

Neben dem Player liegt die Spalte **Freigaben** mit allen Personen, die
hereinkommen – am Projekt wie am Video. Wer nur über ein einzelnes Video
Zugang hat, steht dort mit genau dieser Angabe; ein Klick auf *Zugriff
erweitern* gibt ihm das ganze Projekt oder weitere Videos, ohne neuen Link,
ohne neue Mail, ohne neue Anmeldung.

Beim Freigeben schlägt Klappe **bekannte Gäste desselben Kunden** aus anderen
Projekten vor. Entzug wirkt sofort und trifft nur die eine Person – der Link
bleibt für alle anderen bestehen.

### Kunden-Ablage

Je Projekt gibt es einen Bereich für Kundenmaterial: Briefings, Logos,
Schnittfassungen. Er verhält sich wie ein gewöhnlicher Ordner mit
Unterordnern, Umbenennen und Löschen; ganze Ordner lassen sich hochladen und
als ZIP wieder herunterladen (gestreamt, Zip64-fähig, auch jenseits von 4 GB).

Wer Zugang zum Projekt hat, sieht den ganzen Bereich – anders ließe sich „der
Kunde lädt alles" nicht bauen. Zwei Kunden strikt trennen heißt: zwei Projekte.

### Downloads

**Heruntergeladen wird unter einem festen Schema:**

```
JJMMTT_Kunde_Projektname_Videoname_Versionsnummer_Auflösung.Dateiendung
260304_THD-Marketing_Sommer-Kampagne_Reel-Hochkant_v1_2160p25.mov
```

Das Datum ist das des Uploads und lässt sich ändern. Die Auflösung nennt die
kurze Kante samt Bildrate (`2160p25`, `1080p50`, `1080p2997`). Fehlende Teile –
etwa ein Projekt ohne Kunden – fallen weg, statt Lücken zu hinterlassen.

Das **Original** steht immer zur Verfügung, nie der Proxy. Zusätzlich kann der
Admin Formate anlegen, aus denen der Kunde wählt – siehe
[Einstellungen → Transcode](#transcode).

### Benachrichtigungen

Wer über ein Video Bescheid wissen will, trägt sich in der Spalte
**Benachrichtigungen** ein – am Projekt (gilt für alle Videos) oder am
einzelnen Video. Wer eine Fassung hochlädt, wird automatisch für dieses Video
eingetragen.

Mails werden **gebündelt**: Erst wenn eine einstellbare Ruhezeit lang kein
neuer Kommentar mehr kam (Vorschlag 5 Minuten), geht eine Sammelmail raus – je
Empfänger und Video. `0` verschickt sofort.

Unabhängig vom Mailversand gibt es die **Benachrichtigungszentrale**: das
Glöckchen in der Kopfzeile mit der Zahl der Ungelesenen, dahinter wer, welches
Projekt, welches Video, welcher Timecode und die ersten Zeilen. Die Einträge
entstehen, *bevor* der Versand überhaupt geprüft wird – wer keinen Mailserver
hat oder die Mail übersieht, findet es trotzdem. Auch Gäste haben sie.

Was nicht zugestellt werden konnte, steht unter *Einstellungen → E-Mail-Versand*
im Klartext, mit Empfänger, Betreff und der Meldung des Servers.

### Live-Aktualisierung

Neue Kommentare, Fortschritt und Statuswechsel erscheinen ohne Neuladen. Der
Ereignisstrom meldet dabei bewusst nur, *dass* sich etwas geändert hat; die
Daten holt die Oberfläche über die gewohnten, rechtegeprüften Wege. So bleibt
die Rechteprüfung an einer Stelle statt in einem zweiten Kanal, den man leicht
zu sichern vergisst.

### Verwaltung

Rollen sind **Admin**, **Team-Mitglied** und **Gast**. Team-Mitglieder sehen
alle Projekte des Workspace, Gäste nur, wozu sie eingeladen wurden.

Unter *Einstellungen* stehen Gästeliste, Benutzerverwaltung, benutzerdefinierte
Felder, Erscheinungsbild, Anmeldung, E-Mail-Versand und Transcode. Jeder ändert
sein Passwort selbst unter **Mein Konto** – nach dem ersten Wechsel darf
`ADMIN_PASSWORD` aus der `.env` verschwinden.

---

## Installation

### Schnellstart mit Docker

```bash
cp .env.example .env
# In .env mindestens POSTGRES_PASSWORD, JWT_SECRET, ADMIN_EMAIL und
# ADMIN_PASSWORD setzen. Geheimnisse erzeugen: openssl rand -hex 32
docker compose up -d --build
```

Danach läuft die Oberfläche auf <http://localhost:3000>. Beim ersten Start wird
aus `ADMIN_EMAIL` / `ADMIN_PASSWORD` ein Administrator angelegt; existiert das
Konto bereits, bleibt das Passwort unangetastet.

### Was mindestens in die `.env` gehört

| Variable | Bedeutung |
| --- | --- |
| `POSTGRES_PASSWORD` | Datenbankpasswort |
| `JWT_SECRET` | Signiert Sitzungen und verschlüsselt SMTP-Passwort und OIDC-Secret. Ändert man ihn, sind alle Sitzungen und die hinterlegten Geheimnisse ungültig. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | das erste Konto |
| `PUBLIC_URL` | die Adresse, unter der Klappe erreichbar ist |
| `MEDIA_DIR` | Pfad für die Mediendateien (siehe unten) |

**`PUBLIC_URL` muss stimmen, sobald der Mailversand läuft.** Die Adresse steht
in jedem Freigabe-Link und in jeder Benachrichtigung; bleibt sie auf
`localhost`, bekommt der Kunde eine Mail mit einem Link, der bei ihm ins Leere
führt.

Ein Test ohne HTTPS braucht nichts Zusätzliches: Ob das Sitzungs-Cookie als
`Secure` markiert wird, richtet sich nach `PUBLIC_URL`. Steht dort `http://`,
bleibt die Markierung weg – sonst nähme der Browser das Cookie gar nicht erst
an und die Anmeldung bliebe wortlos stehen. Wer die Automatik übergehen will,
setzt `SESSION_COOKIE_SECURE` von Hand.

### Speicherort der Medien

**`MEDIA_DIR` gehört im Betrieb auf einen echten Pfad.** Ohne Angabe landen die
Dateien in einem benannten Docker-Volume unterhalb von `/var/lib/docker` – und
das ist auf manchen Hosts (Unraid, Synology, Docker Desktop) ein Abbild fester
Größe. Ein einziges 40-GB-Kameraband bringt dann den ganzen Host zum Stehen.

```bash
# in .env
MEDIA_DIR=/mnt/user/klappe-media
```

`UPLOAD_MAX_BYTES` deckelt die Größe je Datei (Standard 200 GB).

Nach außen wird nur `caddy` veröffentlicht. Alles andere bleibt im internen
Netz.

---

## HTTPS

Ohne HTTPS geht es im Betrieb nicht: Das Sitzungs-Cookie wird mit `Secure`
gesetzt, und Freigabe-Links landen bei Kunden im Postfach. Es gibt zwei Wege,
beide ohne Zertifikate von Hand. Sie schließen einander aus.

### Weg 1: Cloudflared-Tunnel (empfohlen, kein Port nach außen)

Der Tunnel baut die Verbindung von innen nach außen auf. Am Router muss
**nichts** freigegeben werden, die Adresse ist sofort per HTTPS erreichbar, und
der Server bleibt aus dem Internet unsichtbar.

1. Bei Cloudflare unter *Zero Trust → Networks → Tunnels* einen Tunnel anlegen
   und den Token kopieren.
2. In der `.env` `PUBLIC_URL=https://klappe.example.org` setzen.
3. Klappe ohne Host-Port starten:

```bash
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d
```

**Ziel im Tunnel ist `http://caddy:80`** – der Dienstname, keine IP-Adresse.
Die ändert sich bei jedem Neuaufbau des Netzes.

> **Nicht auf `web:3000` zeigen.** Caddy verteilt `/v1/*` an die API und alles
> andere an Next. Führte der Tunnel direkt auf Next, liefen die Uploads wieder
> über dessen Weiterleitung – und damit in den `Connection: close`-Fehler, an
> dem Safari zuverlässig scheitert.

**Der Tunnel läuft im Stack.** Der einfachste Fall: cloudflared als weiterer
Dienst neben Klappe. Dann sind beide von Haus aus im selben Netz.

```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
```

**Der Tunnel läuft schon woanders auf demselben Host.** Wer bereits einen
cloudflared für andere Dienste betreibt, hängt ihn zusätzlich ins Klappe-Netz:

```bash
docker network connect klappe_default <name-des-cloudflared-containers>
```

Danach löst `caddy` auch dort auf. Der Beitritt überlebt kein Neuanlegen des
Containers – nach einem Update ist er zu wiederholen.

**Ein Ziel wie `http://<host-ip>:3000` funktioniert in dieser Aufstellung
nicht**, und die Fehlermeldung führt in die Irre. Läuft cloudflared mit eigener
Adresse an einem `macvlan`- oder `ipvlan`-Netz (auf Unraid `br0`), erreicht der
Container zwar andere Container mit eigener Adresse, **nicht aber seinen eigenen
Host**: Die Pakete gehen an dessen Netzkarte vorbei und kommen nie zurück. Im
Tunnel-Log steht dann `Unable to reach the origin service … connect: no route to
host` – ein Fehler auf IP-Ebene, im Unterschied zu `connection refused`, wo der
Host antwortet, aber nichts lauscht. Der Ausweg ist immer derselbe: über das
Docker-Netz gehen, nicht über die Host-Adresse. Nachprüfen ohne cloudflared
anzufassen:

```bash
docker run --rm --network klappe_default alpine \
  wget -qO- -T5 http://caddy:80/login | head -c 80
```

**Zur Upload-Größe:** In Cloudflare gilt eine Obergrenze **pro Anfrage** (im
kostenlosen Plan 100 MB). Klappe überträgt in Blöcken von wenigen Megabyte,
liegt also weit darunter – auch ein 40-GB-Kameraband geht durch. Das ist der
übliche Stolperstein bei Tunneln und hier bewusst keiner.

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
um. Der Reverse Proxy steht schon im Grundstapel; die Ergänzung gibt ihm nur
Domain, Zertifikat und die Ports 80/443. Er reicht `X-Forwarded-Proto` weiter,
gibt Antworten ungepuffert durch (sonst stockt das Video) und deckelt die
Anfragegröße nicht – die Grenze setzt `UPLOAD_MAX_BYTES`.

---

## Einstellungen

Alles Workspace-Weite steht in der Oberfläche unter *Einstellungen*, nicht in
der `.env`.

### Transcode

Hier steht, was der Server nach dem Hochladen erzeugt. Alles davon ist
ausschaltbar, und eine Änderung greift **ab dem nächsten Auftrag** – der Worker
liest die Einstellungen vor jedem Lauf frisch, ein Neustart des Containers ist
nicht nötig.

#### Was ohnehin passiert: die Abspielfassung

**Es wird nur neu kodiert, wenn es sein muss.** Vor dem Transcoding prüft der
Worker das Original: H.264, Ton als AAC oder MP3, Pixelformat `yuv420p`,
MP4-/MOV-Container, kurze Kante klein genug, Bitrate im Rahmen. Passt alles und
liegt der Index bereits vorn, wird die Datei **gar nicht angefasst** und direkt
abgespielt. Fehlt nur der vorgezogene Index, genügt ein Neuverpacken (`-c copy`,
Sekunden statt Minuten, Bild bitgleich). Erst wenn etwas nicht passt, läuft
x264. Was passiert ist, steht an der Fassung (`ORIGINAL` / `REMUX` /
`TRANSCODE`) samt Begründung.

**Skaliert wird auf die kurze Kante, nicht auf die Höhe.** 1080 heißt im
Querformat 1920×1080, im Hochformat 1080×1920 und im Quadrat 1080×1080. Auf die
Höhe zu skalieren, würde einem Hochformat-Clip einen 608 Pixel breiten Proxy
verpassen.

Kurze Kante, Bitrate und x264-Preset lassen sich hier ändern – mit der
Empfehlung, es zu lassen. Sie bestimmen, was jeder im Browser zu sehen bekommt,
und was bereits verarbeitet wurde, ändert sich rückwirkend nicht mit.

#### Download in verschiedenen Formaten

Der Admin legt Formate an: Name, kurze Kante, Video- und Ton-Bitrate,
x264-Preset (`ultrafast` … `veryslow`) und Container (`.mp4` oder `.mov`). Wer
herunterlädt, sieht davon nur Name und Größe.

Der Herunterladen-Knopf öffnet dann ein Fenster. Das **Original** steht immer
oben und geht sofort los; darunter die Formate. Was noch nicht erzeugt ist,
entsteht beim Klick – mit Fortschrittsbalken, und der Download startet von
selbst, sobald es fertig ist. Das Fenster darf so lange offen bleiben.

Erzeugt wird immer aus dem **Original**, nie aus der Abspielfassung: Die ist
bereits einmal kodiert, ein zweiter Durchlauf darüber verstärkt nur Fehler.
Vergrößert wird nie – ein 720p-Original bleibt bei einem 1080p-Format ein
720p-Video, und die Bitrate sinkt mit.

Wird ein Format nachträglich geändert, gelten die schon erzeugten Dateien als
überholt und entstehen beim nächsten Abruf neu. Eine Datei auszuliefern, die
mit dem gewählten Format nichts mehr zu tun hat, wäre schlimmer als ein paar
Minuten Warten. Umbenennen zählt nicht als Änderung.

Ist die Formatauswahl abgeschaltet, lädt der Knopf wie zuvor direkt das
Original.

#### Adaptive Wiedergabe (HLS)

Eine Stufenleiter aus 2160p / 1080p / 720p / 480p, je nachdem, was die Quelle
hergibt. Der Player nimmt sie automatisch, wo der Browser sie abspielt – Safari
von Haus aus, Chrome und Firefox über `hls.js`, das erst bei Bedarf nachgeladen
wird.

Sie kostet einen zweiten vollen Durchlauf über das Original und läuft deshalb
als Nacharbeit: Die Fassung ist vorher schon fertig und abspielbar. Der
progressive Proxy bleibt in jedem Fall die Grundlage fürs frame-genaue
Arbeiten – eine Datei, sofort springbar, ohne Zwischenschicht.

#### Wann gerechnet wird

Die Abspielfassung hat **immer Vorrang** – darauf wartet jemand. Die Nacharbeit
(Formate im Voraus, HLS-Leiter) steht hinten in der Warteschlange und lässt sich
auf ein Zeitfenster legen, etwa 22:00–06:00. Ein laufender ffmpeg wird dabei
nicht abgebrochen; der nächste freie Platz geht an die Abspielfassung.

Nicht vom Zeitfenster betroffen: ein Format, das gerade jemand angefordert hat.
Das läuft sofort, sonst stünde der Kunde acht Stunden vor einem leeren Balken.

Wahlweise entstehen die Formate nur für **Endfassungen**. Wird der Haken später
gesetzt, geht es genau dann los.

#### Verhältnis zur `.env`

`HLS_ENABLED`, `PROXY_SHORT_EDGE`, `PROXY_VIDEO_BITRATE` und `PROXY_PRESET` sind
nur noch die Voreinstellung für eine frische Anlage. Sobald in der Oberfläche
einmal gespeichert wurde, gilt die dortige Einstellung. Eine bestehende Anlage
läuft nach einem Update also unverändert weiter.

Weiterhin nur in der `.env`: `WORKER_CONCURRENCY` (wie viele Transcodes
gleichzeitig laufen). Der Wert steht fest, bevor überhaupt eine
Datenbankverbindung existiert.

### E-Mail-Versand

Generisches SMTP mit Vorlagen für Brevo, Mailgun, Postmark, Amazon SES,
Microsoft 365, Gmail, Outlook.com und iCloud – die Vorlage füllt nur Host, Port
und TLS vor. Dazu ein Testmail-Knopf. Die drei privaten Anbieter brauchen ein
**App-Passwort** statt des normalen Kennworts; der Hinweis steht dabei.

Hier stehen auch die Ruhezeit fürs Bündeln, die Aufbewahrungsfrist für
archivierte Projekte und ganz oben die Liste der unzustellbaren Mails.

Für die Zustellbarkeit gehört zur Absender-Domain SPF und DKIM – sonst landen
Anmeldecodes im Spam.

### Anmeldung über Microsoft 365

1. Im Entra Admin Center eine App-Registrierung anlegen.
2. Unter *Authentifizierung* die Redirect-URI als **Web**-Plattform eintragen.
   Sie steht kopierfertig in den Einstellungen und endet auf
   `/v1/auth/microsoft/callback`.
3. Unter *Zertifikate & Geheimnisse* einen geheimen Clientschlüssel erzeugen.
4. Verzeichnis-ID, Anwendungs-ID und den Schlüssel eintragen und den Schalter
   setzen.

Umgesetzt ist der Authorization-Code-Fluss mit PKCE; das ID-Token wird gegen die
öffentlichen Schlüssel des Tenants geprüft. Angefordert werden nur
`openid profile email`.

**Unbekannte Adressen kommen standardmäßig nicht herein.** Wer sich über M365
anmeldet, braucht hier bereits ein Konto – in einem großen Tenant bekäme sonst
jeder Beschäftigte Zugriff auf alle Projekte. Wer das anders will, schaltet das
automatische Anlegen ein und schränkt es auf die eigenen Domänen ein.

Die lokale Anmeldung lässt sich abschalten, sobald M365 vollständig eingerichtet
ist – vorher weist die API es ab, damit sich niemand aussperrt. Fällt M365
später aus (Secret abgelaufen, Einstellungen gelöscht), lebt sie automatisch
wieder auf. Gäste sind davon nie betroffen.

### Erscheinungsbild

Titel, Logo und eine Akzentfarbe. Aus der einen Farbe werden Hover-Ton und
lesbare Schriftfarbe berechnet. Es gilt überall – Anmeldeseite, Gastzugang und
jede E-Mail.

### Benutzerdefinierte Felder

Felder anlegen, umbenennen, löschen (mit Warnung, wie viele Projekte betroffen
sind). Je Feld einstellbar, ob beim Tippen Vorschläge aus bestehenden Projekten
kommen sollen – sinnvoll beim Kunden, sinnlos bei einer Projektnummer. Auch die
Schlagworte lassen sich hier workspace-weit abschalten.

---

## Eingebetteter Player

Ein Freigabe-Link lässt sich zusätzlich zum Einbetten freischalten
(**Freigeben → Einbetten erlauben**). Daneben steht dann ein fertiger
`iframe`-Schnipsel zum Kopieren.

Das ist bewusst ein eigener Schalter und standardmäßig aus. Ein eingebetteter
Player fragt **weder nach Anmeldecode noch nach Passwort** – anders geht es in
einem fremden `iframe` nicht, weil Browser dort keine Cookies von
Drittanbietern zulassen. Die Adresse allein ist damit der Schlüssel:

- Wer sie hat, sieht das Video. Wer sie nicht hat, bekommt eine 404 – gleich,
  ob der Link nie existierte, nicht freigeschaltet ist oder zurückgezogen wurde.
- Ausgeliefert wird nur die **Abspielfassung**, nie das Original. Über diesen
  Weg lässt sich nichts herunterladen.
- Kommentare, Gästeliste und Projektstruktur bleiben außen vor.
- Zurückziehen wirkt sofort, auch für die Medien dahinter.

Bei einer Projektfreigabe zeigt der Player das zuletzt bearbeitete Video des
Projekts, bei einer Videofreigabe dessen neueste fertige Fassung.

---

## Betrieb

### Sicherung

Zu sichern sind das Medien-Verzeichnis (`MEDIA_DIR`, siehe oben) und die
Datenbank:

```bash
docker compose exec postgres pg_dump -U klappe klappe > klappe-$(date +%F).sql
```

Redis enthält nur Warteschlangen und Ereignisse und muss nicht gesichert werden.

### Was der Aufräumer täglich tut

- verwaiste Dateien im Volume entfernen, mit einem Tag Karenz, damit gerade
  entstehende Dateien in Ruhe bleiben
- abgelaufene Anmeldecodes und abgebrochene Upload-Sitzungen löschen
- alte Fassungen archivierter Projekte nach Ablauf der Frist entfernen; die
  neueste bleibt immer

Was er entfernt, steht im Protokoll.

### Sicherheit

Passwörter liegen als scrypt-Hash, SMTP-Passwort und OIDC-Secret verschlüsselt
(AES-256-GCM, Schlüssel abgeleitet aus `JWT_SECRET`) – die API gibt sie nie
heraus, sondern meldet nur, ob etwas hinterlegt ist. An Anmeldung,
Passwortwechsel, Gastcode, Abmeldelink und M365-Start sitzen Anfragebremsen;
abgelehnte Versuche zählen nicht mit, damit sich niemand selbst aussperren
lässt. Medien-Links für Werkzeuge ohne Sitzung sind signiert, kurzlebig und an
Fassung, Art und Person gebunden – sie **ersetzen die Rechteprüfung nicht**.

---

## Entwicklung

### Aufbau des Repos

```
packages/shared      Typen der Schnittstelle, Timecode-Mathematik, Mention-Format,
                     Zeichnungsformat, Dateinamen, Erkennung im Dateinamen,
                     Schlagworte, Farbableitung fürs Branding
apps/api             NestJS: HTTP-API (main.ts) und Worker (worker.ts)
apps/api/drizzle     SQL-Migrationen
apps/web             Next.js: Oberfläche, Player, Kommentare, Upload-Fenster
docker/              Caddyfile und Routen für den HTTPS-Betrieb
docs/                Architektur, Datenmodell, API-Referenz
```

Mehr dazu in [docs/architektur.md](docs/architektur.md),
[docs/datenmodell.md](docs/datenmodell.md) und [docs/api.md](docs/api.md).

### Ohne Container arbeiten

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

npm run migrate      # Schema einspielen
npm run dev:api      # API auf Port 3001
npm run dev:worker   # Worker (eigenes Terminal)
npm run dev:web      # Oberfläche auf Port 3000 (eigenes Terminal)
```

Prüfen:

```bash
npm run typecheck    # alle Workspaces
npm test             # 428 Tests
npm run build        # shared + API + Web
```

Nach Änderungen am Datenmodell:

```bash
npm run db:generate  # erzeugt eine neue SQL-Migration in apps/api/drizzle/
```

### Bekannte Hinweise

`npm audit` meldet eine Schwachstelle in `libvips` über `sharp`. Das Paket ist
eine **optionale** Abhängigkeit von Next.js und wird nur vom Bildoptimierer
benutzt – den schaltet `next.config.mjs` ausdrücklich ab, weil Klappe alle
Vorschaubilder als schlichtes `<img>` hinter der API-Authentifizierung
einbindet. Der betroffene Weg ist damit nicht erreichbar. Ein
`npm audit fix --force` würde Next auf Version 9 zurückstufen und ist keine
Lösung.

---

## Umgesetzte Phasen

Grober Umfang; die vollständige Aufstellung liegt im Projektplan.

### Grundgerüst (0–4)

| Phase | Inhalt |
| --- | --- |
| 0 | Fundament: Monorepo, docker-compose, Postgres-Schema, Basis-API, lokales Team-Login mit drei Rollen |
| 1 | Projekte und Videos anlegen, resumable Upload nach tus 1.0.0, Versionen je Video |
| 2 | Pipeline: FFmpeg-Worker, Abspielfassung, Posterframe, Sprite-Streifen, Metadaten per `ffprobe` |
| 3 | Player: frame-genaue Wiedergabe, Live-Timecode und Frame-Zähler, Tastaturkürzel |
| 4 | Kommentare am Frame, Threads, @-Mentions, Erledigt-Status |

### Zusammenarbeit mit Kunden (5–9)

| Phase | Inhalt |
| --- | --- |
| 5 | Zeichnen im Bild: Canvas-Overlay, Farbauswahl, an Kommentar und Frame gekoppelt |
| 6 | Freigaben und Gäste: Links auf Projekt oder Video, Zugang per E-Mail-Code, Download-Rechte an drei Schaltern |
| 7 | Kunden-Uploads: Ablage je Projekt, auch für Gäste |
| 8 | E-Mail: SMTP in der Oberfläche mit Vorlagen und Testmail, Benachrichtigungen, Abmeldelink |
| 9 | Verwaltung: Gäste- und Rechteübersicht je Projekt und Video, Zugriff entziehen, letzter Zugriff sichtbar |

### Workspace und Feinschliff (10–13)

| Phase | Inhalt |
| --- | --- |
| 10 | Erscheinungsbild: Titel, Logo und Akzentfarbe, auch in jeder E-Mail |
| 11 | Microsoft 365 über Entra ID mit PKCE, wählbare Anmeldemethoden, Aussperrschutz |
| 12 | Schlagworte und Filter für die Projektliste |
| 13 | HLS-Stufenleiter, signierte Medien-Links, Anfragebremsen, täglicher Aufräumer |

Dazu fünf Nachträge aus dem laufenden Bau: Multi-Upload-Fenster mit Erkennung
aus dem Dateinamen, Download-Namen nach Schema, Skalierung auf die kurze Kante,
Prüfung vor dem Kodieren (`ORIGINAL` / `REMUX` / `TRANSCODE`) und die beiden
HTTPS-Wege.

### Aus dem Alltagsbetrieb (14–19)

| Phase | Inhalt |
| --- | --- |
| 14 | Eigenes Passwort ändern, Upload startet vor der Zuordnung, zentrales Upload-Fenster, Fassungen löschen, freie Versionsnummern (`v2.5`), Brotkrumen, Player-Layout, Safari-Upload über XHR, eingebetteter Player |
| 15 | Kunden und benutzerdefinierte Felder als Filter, Sortierung und Gruppierung; Umbenennen und Löschen überall; Kunden-Ablage als Ordnerstruktur mit ZIP-Download; Speichern je Upload-Zeile |
| 16 | Aufgeräumte Player-Leiste mit Symbolen und „…"-Menü, rechte Spalte mit Reitern *Kommentare* und *Freigaben*, Rechte pro Person, Kunde als gleichberechtigtes Freifeld, Schlagworte abschaltbar |
| 17 | Mobiloptimierung, Kommentare nach Timecode oder Erstellung sortieren, Endfassungs-Haken mit Warnung beim Kunden, Benutzer und Gäste in die Einstellungen mit senkrechtem Menü |
| 18 | Gebündelte Mails mit Ruhezeit, Spalte *Benachrichtigungen* je Projekt und Video, Benachrichtigungszentrale, Video-Gäste sichtbar und erweiterbar, Freigabe an bekannte Gäste desselben Kunden, Verarbeitung parallel zur Eingabe · **Zusatz:** Projekte archivieren, Live-Aktualisierung statt Nachladen, unzustellbare Mails sichtbar |
| 19 | Einstellungsseite *Transcode*: Download in verschiedenen Formaten mit Fortschritt, Format-Presets, Vorab-Erzeugung mit Vorrangregel, Zeitfenster für die Nacharbeit, HLS-Schalter und Proxy-Werte aus der Datenbank statt aus der `.env` |
