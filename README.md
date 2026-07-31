# Klappe

Selbst gehostetes Review- und Freigabe-Werkzeug für Videoproduktionen – die
eigene Alternative zu Frame.io.

Schnittfassungen hochladen, frame-genau ansehen, am Bild kommentieren und
zeichnen, per Link an Kunden freigeben, Rückmeldungen einsammeln, freigeben,
herunterladen. Alles läuft im eigenen Docker-Stack: keine fremde Cloud, kein
Abo pro Kopf, und das Kameramaterial verlässt das Haus nicht.

Ein Container-Stack trägt genau **einen Workspace** mit eigenem Logo, Titel und
eigener Farbe. Wer zwei Firmen strikt trennen will, betreibt zwei Stapel.

**Stand: Phasen 0–23 sind gebaut und geprüft.** Der grobe Umfang steht unten
unter [Umgesetzte Phasen](#umgesetzte-phasen).

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
- [Lizenz](#lizenz)

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
`v2` und `v3` – nur doppelt darf keine sein, und beim Hochladen geht es nicht
rückwärts. Nachträglich lässt sich eine Nummer ändern (Phase 25), um
Fehleingaben zu begradigen – dabei ist jede freie Nummer erlaubt.

Ein Haken **Endfassung** trennt Zwischenstand von Fertigem. Ohne ihn sieht der
Kunde einen Hinweis, und der Dateiname trägt `Vorschau`.

Projekte tragen einen Kunden und beliebige **benutzerdefinierte Felder** (etwa
eine Projektnummer), die in den Einstellungen angelegt werden. Nach jedem Feld
lässt sich filtern, sortieren und gruppieren – Kunde und Schlagworte sind dabei
ganz normale Dimensionen, keine Sonderfälle. Je Feld ist einstellbar, ob es in
der Filterleiste, der Sortier- und der Gruppier-Auswahl steht und ob sein Wert
auf der Projektkachel erscheint. Der Kunde steht dort groß über dem Projektnamen – wer viele Projekte
hat, sucht zuerst nach dem Kunden.

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
weicht die Frame-Nummer und der Timecode bleibt. Im **Vollbild** fährt die
Kommentarspalte auf Knopfdruck von rechts ein – kommentieren geht also auch
dort, ohne das Vollbild zu verlassen.

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
Gäste brauchen kein Konto und kein Passwort: Sie geben ihre E-Mail an und
bekommen einen sechsstelligen Code. Nach dem Namen wird **einmal** gefragt,
beim allerersten Besuch – danach nie wieder. Wer noch angemeldet ist, geht
ohne jeden Zwischenschritt durch. Je Link ist einstellbar, ob kommentiert,
heruntergeladen und hochgeladen werden darf; abweichende Rechte lassen sich
zusätzlich **pro Person** setzen.

Wer seinen Link nicht mehr findet, kommt über **Gastzugang** auf der
Anmeldeseite herein – ebenfalls nur mit Adresse und Code. Ein Konto entsteht
dabei nicht: Für eine Adresse ohne Freigabe geht **keine Mail** raus, die
Absage steht im Browser.

Neben dem Player liegt die Spalte **Freigaben** mit allen Personen, die
hereinkommen – am Projekt wie am Video. Wer nur über ein einzelnes Video
Zugang hat, steht dort mit genau dieser Angabe; ein Klick auf *Zugriff
erweitern* gibt ihm das ganze Projekt oder weitere Videos, ohne neuen Link,
ohne neue Mail, ohne neue Anmeldung.

Beim Freigeben schlägt Klappe **bekannte Gäste desselben Kunden** vor – am
Projekt wie am einzelnen Video. Ein Klick nimmt sie auf, ohne neuen Link; auf
Wunsch (Standard) bekommen sie einen kurzen Hinweis per Mail, dass etwas Neues
für sie offensteht.

Für die Zusammenarbeit mit Agenturen gibt es den **Externen Projektadmin**:
ein Häkchen an der Projektfreigabe eines Gastes. Damit darf er in genau diesem
Projekt Videos anlegen, Fassungen hochladen und löschen, weiter freigeben und
fremde Kommentare verwalten – Projekt und Videos umbenennen oder löschen
bleibt dem Team vorbehalten, ebenso das Ändern und Zurückziehen bestehender
Freigabe-Links.

Entzug wirkt sofort und trifft nur die eine Person – der Link bleibt für alle
anderen bestehen. Wer entzogen wurde, kommt mit dem alten Link auch **nicht
mehr über einen neuen Code** herein; er braucht eine neue Freigabe.

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
260304_Beispiel-Marketing_Sommer-Kampagne_Reel-Hochkant_v1_2160p25.mov
```

Das Datum ist das des Uploads und lässt sich ändern. Die Auflösung nennt die
kurze Kante samt Bildrate (`2160p25`, `1080p50`, `1080p2997`). Fehlende Teile –
etwa ein Projekt ohne Kunden – fallen weg, statt Lücken zu hinterlassen.

Der Herunterladen-Knopf öffnet **immer** ein Fenster, auch ohne eingerichtete
Formate: Dort steht der Dateiname, unter dem die Datei gleich auf der Platte
landet, und bei einem Zwischenstand die Warnung dazu. Beides ist nach dem Klick
nicht mehr zu haben.

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
Empfänger und Video. `0` verschickt sofort. Gebündelt wird nur, worauf niemand
wartet; **Anmeldecodes gehen immer sofort und ohne Umweg über die
Warteschlange** raus.

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
alle Projekte des Workspace, Gäste nur, wozu sie eingeladen wurden. Einen Weg
vom Gast ins Team gibt es bewusst nicht – die beiden melden sich grundsätzlich
verschieden an (Code gegen Passwort/Microsoft 365); für einen echten Kollegen
entsteht ein eigenes Konto unter *Benutzer*.

Unter *Einstellungen* stehen Gästeliste, Benutzerverwaltung, benutzerdefinierte
Felder, Erscheinungsbild, Anmeldung, E-Mail-Versand, Projekte und Transcode.
Jeder – Team wie Gast – ändert seinen Namen selbst unter **Mein Konto**; das
Team dort auch sein Passwort. Nach dem ersten Wechsel darf `ADMIN_PASSWORD`
aus der `.env` verschwinden.

### Handbuch und „Über diese Software“

In der Kopfzeile stehen für jeden Angemeldeten – Team wie Gäste – zwei
weitere Seiten: **Handbuch** erklärt Anmeldung, Player, Kommentieren,
Freigeben und alles Übrige aus Sicht der Benutzung; **Über diese Software**
nennt Autor und Software und trägt einen Freitext, den jeder Admin für die
eigene Umgebung pflegt (z. B. „läuft auf nativer Hardware“). Das Handbuch
liegt zusätzlich als Markdown unter [docs/handbuch.md](docs/handbuch.md) in
der Repo.

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

Die Stufe wählt normalerweise die Automatik nach der gemessenen Bandbreite; in
der Steuerleiste steht dann **Auto** samt der gerade gespielten Stufe in
Klammern. Wer eine bestimmte Stufe sehen will – etwa garantiert 1080p für die
Abnahme –, wählt sie im selben Dropdown fest; *Auto* gibt die Wahl zurück.
Unter Safari entfällt der Umschalter, dessen natives HLS bietet dafür keine
Schnittstelle.

Sie kostet einen zweiten vollen Durchlauf über das Original und läuft deshalb
als Nacharbeit: Die Fassung ist vorher schon fertig und abspielbar. Der
progressive Proxy bleibt in jedem Fall die Grundlage fürs frame-genaue
Arbeiten – eine Datei, sofort springbar, ohne Zwischenschicht.

#### Wann gerechnet wird

Die Seite hat drei Abschnitte für drei verschiedene Dinge, und **jeder bringt
seinen eigenen Zeitplan mit**: die Download-Formate, die HLS-Leiter, die
Abspielfassung. Zur Wahl stehen jeweils *erst beim Download* bzw. *nicht
rechnen*, *direkt beim Upload* und *nach Zeitplan*; bei Letzterem erscheinen
Uhrzeiten, vorbelegt mit 22:00–06:00.

Die Abspielfassung hat **immer Vorrang** – darauf wartet jemand – und steht
deshalb ohne Zeitplan da. Ein laufender ffmpeg wird nicht abgebrochen; der
nächste freie Platz geht an die Abspielfassung. Ebenfalls nicht vom Zeitplan
betroffen: ein Format, das gerade jemand angefordert hat. Das läuft sofort,
sonst stünde der Kunde acht Stunden vor einem leeren Balken.

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

#### OAuth2 für Microsoft 365 (bei erzwungener Mehrfaktor-Anmeldung)

Erzwingt der Tenant Mehrfaktor-Anmeldung, lehnt `smtp.office365.com` ein
Kennwort ab – auch ein App-Kennwort hilft dabei nicht zuverlässig. Klappe
unterstützt deshalb zusätzlich den Client-Credentials-Fluss (App-only, ohne
Anmeldefenster):

1. Im Entra Admin Center eine App-Registrierung anlegen (kann dieselbe sein
   wie für die Anmeldung, muss es aber nicht).
2. Unter *API-Berechtigungen* die **Microsoft-Graph-Anwendungsberechtigung**
   `SMTP.SendAsApp` hinzufügen und die Admin-Zustimmung erteilen.
3. Unter *Zertifikate & Geheimnisse* einen geheimen Clientschlüssel erzeugen.
4. Per Exchange Online PowerShell die App auf das sendende Postfach
   einschränken – ohne diesen Schritt dürfte sie tenant-weit als jedes
   Postfach senden:
   ```powershell
   New-ApplicationAccessPolicy -AppId "<Anwendungs-ID>" `
     -PolicyScopeGroupId "versand@contoso.de" -AccessRight RestrictAccess `
     -Description "Nur Klappe darf als dieses Postfach senden"
   ```
5. In den Einstellungen unter *Authentifizierung* auf **OAuth2** umstellen und
   Verzeichnis-ID, Anwendungs-ID, Client-Secret sowie das absendende Postfach
   eintragen.

Klappe holt sich das Zugriffstoken bei Bedarf selbst (Gültigkeit rund eine
Stunde) und hält es bis kurz vor Ablauf vor – ein Neustart ist dafür nicht
nötig.

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

Titel, Logo und eine Akzentfarbe. Dazu das **Symbol im Browser-Tab**: wahlweise
das mitgelieferte Klappe-Zeichen, das Logo von oben oder eine eigens dafür
hochgeladene Datei (PNG, SVG oder ICO). Die dritte Möglichkeit gibt es, weil
ein breiter Schriftzug im 16-Pixel-Tab zu Brei wird. Aus der einen Farbe werden Hover-Ton und
lesbare Schriftfarbe berechnet. Es gilt überall – Anmeldeseite, Gastzugang und
jede E-Mail.

Dazu **Firmenname und Kürzel**. Das Kürzel steht in Klammern hinter jedem Namen
aus dem eigenen Team – in den Kommentaren, in den Gästelisten, bei „Hochgeladen
von". In einem Projekt sitzen Leute aus zwei Häusern; so ist an jeder Stelle zu
sehen, wer von welcher Seite schreibt. Gäste bekommen keines.

### Projekte

Wie lange die alten Fassungen eines archivierten Projekts liegen bleiben
(Standard 30 Tage). Danach räumt der tägliche Aufräumer sie weg; die neueste
bleibt immer.

### Benutzerdefinierte Felder

Felder anlegen, umbenennen, löschen (mit Warnung, wie viele Projekte betroffen
sind). Je Feld einstellbar: ob beim Tippen Vorschläge aus bestehenden Projekten
kommen (sinnvoll beim Kunden, sinnlos bei einer Projektnummer), ob es in der
Filterleiste, der Sortier- und der Gruppier-Auswahl der Projektliste steht, und
ob sein Wert auf der Projektkachel erscheint. Auch die Schlagworte lassen sich
hier workspace-weit abschalten.

### Speicher

Wie voll das Dateisystem hinter `MEDIA_DIR` ist: frei, belegt, gesamt – und
darunter, was davon auf Klappe entfällt, aufgeschlüsselt nach Originalen,
Abspielfassungen, Download-Formaten, Kundenmaterial und angefangenen Uploads.
Ab 90 % Belegung steht dort eine Warnung, ab 95 % ein deutlicher Hinweis: Läuft
das Dateisystem voll, brechen Uploads mitten in der Übertragung ab.

Gemessen wird das **Dateisystem**, nicht der Ordner – auf einer NAS liegt dort
oft noch anderes, und genau das soll man sehen. Die Klappe-Summe stammt dagegen
aus der Datenbank; Posterframes, Sprite-Streifen und HLS-Segmente führt Klappe
ohne Größe und fehlen darin. Sie ist damit eine Untergrenze, kein `du`.

Steht statt des Balkens ein Hinweis, liegt der Medienordner auf einer
**Durchreiche aus einer virtuellen Maschine** – so ist es bei Docker Desktop
auf dem Mac (VirtioFS) und unter WSL2 (`9p`). Die API läuft dort in der VM und
bekommt vom Betriebssystem Größen genannt, die zur Zwischenschicht gehören und
nicht zur Platte: Auf einer 2-TB-SSD kamen so 57 TB heraus. Klappe erkennt das
inzwischen und zeigt lieber nichts als eine erfundene Zahl. Der echte Wert
steht auf dem Wirtssystem selbst – `df -h` auf den Medienordner. Die
Aufschlüsselung darunter ist davon nicht betroffen. Unraid-User-Shares
(`/mnt/user/…`) sind ausdrücklich **nicht** betroffen: Die sind zwar ebenfalls
FUSE, melden aber die wahre Größe des Arrays.

---

## Eingebetteter Player

Ein Video lässt sich in eine fremde Seite einbetten – über das **„…"-Menü →
Einbetten**, nicht über die Freigaben. Das ist bewusst getrennt: Ein
Freigabe-Link heißt „melde dich an und kommentiere", ein Einbett-Link heißt
„wer die Adresse hat, sieht das Video". Dasselbe Ding für beides war zu Recht
als verwirrend gemeldet.

Der Einbett-Link ist deshalb ein eigener Link mit eigenen Regeln:

- **Anmelden geht damit nicht.** Wer ihn ins Gast-Gatter tippt, bekommt
  dieselbe Antwort wie bei einer erfundenen Adresse.
- Er taucht in der Freigabenliste **nicht** auf und hat keine Rechte-Schalter.
- Ausgeliefert wird nur die **neueste Endfassung**, und nur deren
  Abspielfassung – nie das Original. Ohne gesetzten Endfassungs-Haken bleibt
  der Player leer; das Einbetten-Fenster sagt das vorher.
- **HLS wird mitbenutzt**, wenn für die Fassung eine Leiter erzeugt wurde –
  auf einer fremden Seite sitzt oft genau die schwache Leitung, für die sie
  gedacht ist.
- Kommentare, Gästeliste und Projektstruktur bleiben außen vor.
- Zurückziehen wirkt sofort, auch für die Medien dahinter.

Je Video gibt es höchstens einen Einbett-Link. Wer die Adresse hat, sieht das
Video – ein `iframe` kann keine Anmeldung mitbringen, weil Browser dort keine
fremden Cookies zulassen.

> **Umstieg von Phase 22:** Vorher war Einbetten ein Schalter am gewöhnlichen
> Freigabe-Link. Diese Einbettungen laufen nicht weiter – der neue Link ist
> ein anderer. Wo bereits ein Player eingebunden ist, muss der Schnipsel
> einmal neu geholt werden.

---

## Betrieb

### Sicherung

Zu sichern sind zwei Dinge: das Medien-Verzeichnis (`MEDIA_DIR`, siehe oben)
und die Datenbank.

**Die Datenbank sichert Klappe auf Wunsch selbst** – unter *Einstellungen →
Datensicherung*. Dort steht, ob automatisch gesichert wird, in welchem Abstand
(Vorgabe 24 Stunden) und wie lange die Dateien liegen bleiben (Vorgabe 30
Tage). Daneben ein Knopf für eine Sicherung sofort. Die Dumps landen als
`pg_dump --format=custom` in `<MEDIA_DIR>/backups/`; der tägliche Aufräumer
lässt diesen Ordner in Ruhe.

Aus derselben Seite lässt sich eine Sicherung auch **wiederherstellen**. Das
ersetzt den gesamten Stand der Datenbank, verlangt deshalb ein getipptes
Bestätigungswort – und legt vorher von selbst eine Sicherung des jetzigen
Standes an. **Danach den Stapel neu starten:** Die laufenden Prozesse halten
Verbindungen und Zwischenstände, die zur bisherigen Datenbank gehören. Die
Mediendateien bleiben dabei unberührt; zeigt die eingespielte Datenbank auf
Fassungen, die inzwischen gelöscht wurden, fehlen deren Dateien.

Von Hand geht es weiterhin:

```bash
docker compose exec postgres pg_dump -U klappe klappe > klappe-$(date +%F).sql
```

**Das Medien-Verzeichnis sichert Klappe nicht** – es liegt im selben Volume,
und eine Kopie daneben wäre keine Sicherung. Dafür ist die Sicherung des Hosts
zuständig.

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

### Mac mit Apple Silicon (Hardware-Transcoding)

Auf einem Mac mit Apple Silicon (Mac Mini, Mac Studio, …) kodiert Apples
Media-Engine H.264 um ein Vielfaches
schneller als die CPU – aber nur außerhalb von Docker, denn im Container
gibt es kein VideoToolbox. Dafür gibt es einen eigenen Aufbau: Der Stack
bleibt im Container, nur der Worker läuft nativ auf macOS
(`VIDEO_ENCODER=h264_videotoolbox`), gestartet über das Overlay
`docker-compose.mac.yml`. Die Einrichtung Schritt für Schritt steht in
[docs/apple-silicon.md](docs/apple-silicon.md); wie man den Mac selbst für
den Dauerbetrieb einrichtet (Homebrew und Docker, Neustart nach
Stromausfall, kein Ruhezustand, automatische Anmeldung, Automounts, SSH),
in [docs/mac-server.md](docs/mac-server.md).

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
deploy/mac/          launchd-Vorlage für den nativen Worker auf Apple Silicon
docs/                Architektur, Datenmodell, API-Referenz, Mac-Betrieb
```

Mehr dazu in [docs/architektur.md](docs/architektur.md),
[docs/datenmodell.md](docs/datenmodell.md) und [docs/api.md](docs/api.md).
Das Handbuch für Benutzer und Gäste liegt in
[docs/handbuch.md](docs/handbuch.md) – derselbe Text steht auch in der
Anwendung selbst unter *Handbuch*.

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
npm test             # 457 Tests
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

### Aus dem Alltagsbetrieb (14–20)

| Phase | Inhalt |
| --- | --- |
| 14 | Eigenes Passwort ändern, Upload startet vor der Zuordnung, zentrales Upload-Fenster, Fassungen löschen, freie Versionsnummern (`v2.5`), Brotkrumen, Player-Layout, Safari-Upload über XHR, eingebetteter Player |
| 15 | Kunden und benutzerdefinierte Felder als Filter, Sortierung und Gruppierung; Umbenennen und Löschen überall; Kunden-Ablage als Ordnerstruktur mit ZIP-Download; Speichern je Upload-Zeile |
| 16 | Aufgeräumte Player-Leiste mit Symbolen und „…"-Menü, rechte Spalte mit Reitern *Kommentare* und *Freigaben*, Rechte pro Person, Kunde als gleichberechtigtes Freifeld, Schlagworte abschaltbar |
| 17 | Mobiloptimierung, Kommentare nach Timecode oder Erstellung sortieren, Endfassungs-Haken mit Warnung beim Kunden, Benutzer und Gäste in die Einstellungen mit senkrechtem Menü |
| 18 | Gebündelte Mails mit Ruhezeit, Spalte *Benachrichtigungen* je Projekt und Video, Benachrichtigungszentrale, Video-Gäste sichtbar und erweiterbar, Freigabe an bekannte Gäste desselben Kunden, Verarbeitung parallel zur Eingabe · **Zusatz:** Projekte archivieren, Live-Aktualisierung statt Nachladen, unzustellbare Mails sichtbar |
| 19 | Einstellungsseite *Transcode*: Download in verschiedenen Formaten mit Fortschritt, Format-Presets, Vorab-Erzeugung mit Vorrangregel, Zeitfenster für die Nacharbeit, HLS-Schalter und Proxy-Werte aus der Datenbank statt aus der `.env` |
| 20 | Gast-Anmeldung auf Mail und Code verkürzt (Name nur beim ersten Mal, Sitzung führt direkt durch), *Gastzugang* auf der Anmeldeseite ohne Selbstregistrierung, entzogene Zugänge entwerten den Link, Firmenkürzel hinter Team-Namen, bekannte Gäste auch am Video mit Hinweis-Mail, Transcode-Seite nach Aufgaben gegliedert mit je eigenem Zeitplan, eigene Seite *Projekte*, Gäste getrennt von Benutzern, Zeichnungen in Fahrt ein-/ausblendbar |
| 21 | Rechtestufe **Externer Projektadmin** je Projektfreigabe (Videos anlegen, Fassungen hochladen und löschen, weiter freigeben, fremde Kommentare verwalten), Zeichnung heftet den Kommentar verlässlich an den Frame, Kommentarspalte im Vollbild, eigener Name unter *Mein Konto* änderbar (auch Gäste), GitHub-Link unter *Über diese Software*, kein Rollenwechsel Gast → Team mehr |
| 22 | Stufenwahl im HLS-Player (Auto mit Anzeige der laufenden Stufe oder feste Wahl), Felder je einzeln filter-/sortier-/gruppierbar und auf der Kachel anzeigbar, Kunde groß auf der Projektkachel, Transcode-Seite ohne überlappenden Haken · **Nachtrag:** Einstellungsseite *Speicher* mit freiem Platz und Aufschlüsselung |
| 23 | Download-Fenster immer mit Dateiname und Vorschau-Warnung, eigenes Tab-Symbol, Einbetten als eigener Link im „…"-Menü (keine Anmeldung, nur Endfassungen, mit HLS), automatische Datenbanksicherung samt Wiederherstellen |
| 24 | Benutzer-Menü in der Kopfzeile (Profil, Handbuch, Über, Einstellungen, Abmelden), senkrechtes Menü als Schublade in *Einstellungen* und *Handbuch*, Projektliste mit Suche/Filter/Sortierung/Gruppierung hinter Symbolen, Schlagwort-Verwaltung in den Freifeld-Einstellungen, Videos per Knopf statt Ablagefläche, Favicon (`.ico`) und App-Symbol (PNG) zum Hochladen samt Web-App-Manifest, einstellbare Passwort-Richtlinie, *Über diese Software* mit Quellcode und AGPL-3.0, Transcode-Formate auf schmalen Schirmen als Karten · **Nachtrag:** KI-Kennzeichnung nach Art. 50 EU AI Act – Haken am Video (gilt für alle Fassungen), wählbare Arten (ab Werk KI-Stimme/KI-Video/KI-Sounds/KI-Musik, unter *Einstellungen → KI-Inhalte* erweiterbar), Hinweis für alle Betrachter, global abschaltbar |
| 25 | Fassungsnummern nachträglich änderbar („…“-Menü am Video; jede freie Nummer, die Aufwärts-Regel gilt nur beim Hochladen), Namensvorschlag im Upload-Fenster ohne Kunden- und Projektname (stünde im Download-Dateinamen doppelt), Vorschlag rechnet bei Projektwechsel nach – solange der Name nicht von Hand geändert wurde |

---

## Lizenz

Klappe steht unter der **GNU Affero General Public License, Version 3**
(AGPL-3.0-only). Der vollständige Text liegt in [`LICENSE`](LICENSE).

Was das praktisch heißt:

- **Selbst hosten und nutzen darf jeder, kostenlos, auch gewerblich.** Genau
  dafür ist das Tool gebaut. Wer es aus diesem Repository nimmt, in den eigenen
  Docker-Stack stellt und damit arbeitet, hat mit der Lizenz nichts weiter zu
  tun.
- **Ändern darf jeder.** Solange die geänderte Fassung im eigenen Haus bleibt,
  entsteht keine Pflicht.
- **Wer eine geänderte Fassung über das Netz für andere zugänglich macht, muss
  den Quellcode dieser Fassung herausgeben** – auch ohne sie zu verteilen.
  Das ist §13 der AGPL und der einzige Unterschied zur gewöhnlichen GPL. Ein
  gehosteter Dienst auf Basis von Klappe ist also möglich, aber nicht als
  geschlossener Fork.

Die Lizenz bindet nur andere, nicht den Rechteinhaber. Eine abweichende,
kommerzielle Lizenz für Dritte bleibt jederzeit möglich.

Die Abhängigkeiten (NestJS, Next.js, React, BullMQ, Drizzle, Express) stehen
unter MIT beziehungsweise Apache-2.0 und sind damit verträglich. `ffmpeg` wird
als eigener Prozess aufgerufen, nicht eingebunden.

```
Copyright (C) 2026 Jonathan Fuhr

Dieses Programm ist freie Software: Sie können es unter den Bedingungen der
GNU Affero General Public License, Version 3, wie von der Free Software
Foundation veröffentlicht, weitergeben und/oder verändern.

Die Veröffentlichung erfolgt in der Hoffnung, dass es von Nutzen sein wird,
aber OHNE JEDE GEWÄHRLEISTUNG – sogar ohne die implizite Gewährleistung der
MARKTFÄHIGKEIT oder EIGNUNG FÜR EINEN BESTIMMTEN ZWECK. Details in der
GNU Affero General Public License.
```
