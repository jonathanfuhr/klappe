# Einen Mac als Server einrichten

[apple-silicon.md](apple-silicon.md) beschreibt, wie Klappe auf einen Mac
kommt. Diese Seite beschreibt das Drumherum: die Einstellungen, mit denen ein
Mac Mini oder Mac Studio unbeaufsichtigt durchläuft – Stromausfall, Neustart
und Ruhezustand inklusive. Alle Befehle laufen im Terminal; `sudo` fragt nach
dem Passwort eines Administrators.

## Grundausstattung: Homebrew und Docker

Auf einem frischen Mac zuerst Homebrew – der Installer holt sich bei Bedarf
auch Apples Command Line Tools:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Auf Apple Silicon liegt Homebrew unter `/opt/homebrew` und muss einmal in
den Pfad:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

Dann Docker Desktop:

```bash
brew install --cask docker-desktop
open -a Docker
```

Der erste Start will einmal Bildschirm und Maus sehen (Lizenz bestätigen,
Systemerweiterung erlauben) – das erledigt man am besten, solange Monitor
und Tastatur noch dranhängen, zusammen mit dem Autostart-Häkchen aus dem
Abschnitt weiter unten. Wer statt Docker Desktop das schlankere OrbStack
bevorzugt: `brew install --cask orbstack` – alles Weitere gilt unverändert.

Die Werkzeuge für Klappe selbst – `node@22` und `ffmpeg` – installiert
[apple-silicon.md](apple-silicon.md) im Zuge der Einrichtung.

## Die Kette nach dem Stromausfall

Damit der Server ohne Tastatur und Monitor wieder hochkommt, müssen vier
Glieder halten:

1. Der Mac startet von selbst wieder (`autorestart`, unten).
2. macOS meldet den Benutzer automatisch an – erst mit der Anmeldung startet
   Docker Desktop.
3. Docker startet die Container von selbst – `restart: unless-stopped` steht
   bereits im Compose, dafür ist nichts zu tun.
4. Den Worker startet launchd als LaunchDaemon schon beim Boot, noch vor
   jeder Anmeldung (siehe [apple-silicon.md](apple-silicon.md)).

Die Punkte 1 und 2 sind Einstellungen am Mac – um die geht es hier.

## Strom und Ruhezustand

```bash
# Nie in den Ruhezustand – ein schlafender Server ist keiner.
sudo pmset -a sleep 0

# Platten wach lassen; wichtig, wenn der Medienordner auf einer externen
# Platte liegt.
sudo pmset -a disksleep 0

# Nach einem Stromausfall von selbst wieder starten.
sudo pmset -a autorestart 1

# Aus dem Netz aufweckbar (Wake on LAN) – schadet nie.
sudo pmset -a womp 1
```

Kontrolle: `pmset -g` zeigt alle Werte. `autorestart` gibt es nur auf
Desktop-Macs; ein MacBook kennt die Einstellung nicht.

Dazu der automatische Neustart, falls das System je einfriert:

```bash
sudo systemsetup -setrestartfreeze on
```

`systemsetup` verlangt auf neueren macOS-Versionen, dass die Terminal-App
Festplattenvollzugriff hat (Systemeinstellungen → Datenschutz & Sicherheit).
Wer sich das sparen will, findet dieselben Schalter in den
Systemeinstellungen unter „Energie".

## FileVault aus, automatische Anmeldung an

Nach einem Neustart soll niemand mit Tastatur danebenstehen müssen. Dem
stehen zwei Dinge im Weg:

- **FileVault.** Mit eingeschalteter Verschlüsselung wartet der Mac vor dem
  eigentlichen Start auf ein Passwort – daran kommt man aus der Ferne nicht
  vorbei. Status prüfen mit `fdesetup status`, ausschalten unter
  Systemeinstellungen → Datenschutz & Sicherheit → FileVault. Das ist eine
  bewusste Abwägung: Wer physisch an den Mac kommt, kommt dann auch an die
  Daten. Für einen Server im Büro oder zu Hause ist das üblicherweise in
  Ordnung – andernfalls gehört er in einen abschließbaren Raum.
- **Die Anmeldung.** Docker Desktop startet erst mit der Benutzeranmeldung.
  Deshalb: Systemeinstellungen → Benutzer & Gruppen → „Automatisch anmelden
  als" auf den Benutzer stellen, unter dem Docker läuft. Eine saubere
  Befehlszeile gibt es dafür nicht; die bekannten Umwege schreiben das
  Passwort verschleiert auf die Platte und sind die Mühe nicht wert.

Der native Worker ist von beidem unabhängig – als LaunchDaemon läuft er ab
dem Boot, Anmeldung hin oder her.

## Docker automatisch starten

In Docker Desktop unter Settings → General den Start beim Anmelden
aktivieren („Start Docker Desktop when you sign in to your computer"). Mehr
braucht es nicht: Sobald Docker läuft, holt `restart: unless-stopped` alle
Dienste von selbst zurück.

## Fernzugriff

SSH einschalten, damit der Mac ohne Monitor wartbar bleibt:

```bash
sudo systemsetup -setremotelogin on
```

Alternativ Systemeinstellungen → Allgemein → Teilen → „Entfernte Anmeldung".
Dort lässt sich auch die Bildschirmfreigabe aktivieren – praktisch für die
seltenen Fälle, in denen Docker Desktop einen Dialog anzeigt, den man sehen
muss.

Für den Zugriff von unterwegs hat sich ein Mesh-VPN wie Tailscale bewährt:
SSH und Bildschirmfreigabe bleiben damit im privaten Netz, und nach außen
zeigt weiterhin nur der Cloudflared-Tunnel bzw. Caddy (siehe README,
Abschnitt HTTPS).

## Updates mit Bedacht

Automatische macOS-Updates starten den Mac neu, wann es ihnen passt – mitten
im Transcoding ist das der falsche Moment. Empfehlung: Systemeinstellungen →
Allgemein → Softwareupdate → Updates automatisch **laden**, aber nicht
automatisch **installieren**; nur Sicherheitsmaßnahmen dürfen sofort.
Updates dann bewusst einspielen, wenn gerade nichts rechnet – danach kommt
alles von selbst wieder hoch, das ist ja der Sinn dieser Seite.

Nach einem `brew upgrade ffmpeg` gilt weiterhin: einmal ins Worker-Log
schauen bzw. eine Probedatei hochladen (siehe
[apple-silicon.md](apple-silicon.md)).

## Netzwerkpfade automatisch einbinden

Ein im Finder verbundenes Netzlaufwerk gibt es erst nach der Anmeldung, und
nach einem Abbruch bleibt es weg – für einen Server zu wenig. macOS bringt
dafür autofs mit: zwei Einträge, und die Freigabe wird beim ersten Zugriff
eingebunden, nach Unterbrechungen auch von selbst wieder.

Beispiel: Die SMB-Freigabe `sicherung` eines NAS soll unter
`/Users/Shared/nas/sicherung` erscheinen.

```bash
# 1. Eine direkte Map in /etc/auto_master anmelden:
echo '/- auto_nas -nosuid' | sudo tee -a /etc/auto_master

# 2. Die Map anlegen. Die Zugangsdaten stehen darin im Klartext –
#    deshalb gehört die Datei allein root:
sudo sh -c 'echo "/Users/Shared/nas/sicherung -fstype=smbfs,soft,noowners,nosuid ://benutzer:passwort@nas.local/sicherung" > /etc/auto_nas'
sudo chmod 600 /etc/auto_nas

# 3. Übernehmen – eingebunden wird beim ersten Zugriff:
sudo automount -cv
ls /Users/Shared/nas/sicherung
```

Sonderzeichen im Passwort müssen URL-kodiert sein (`@` → `%40`, Leerzeichen
→ `%20`). Für NFS statt SMB lautet der Eintrag in der Map
`/Users/Shared/nas/sicherung -fstype=nfs nfs://nas.local:/mnt/user/sicherung`.

Wofür das gedacht ist: Sicherungsziele und Datenübernahmen, etwa beim Umzug.
**Der Medienordner (`MEDIA_DIR`) gehört nicht auf ein Netzlaufwerk**,
sondern auf eine lokale Platte: Der Worker läuft mit seinem täglichen
Aufräumer über den ganzen Medienbaum, und ein hakender Mount ist von einem
leeren Ordner nicht zu unterscheiden; dazu vertragen sich Docker-Bind-Mounts
schlecht mit SMB. Nach einem Neustart gehört der Automount – wie eine
externe Medienplatte – mit in die Ernstfall-Probe unten: einmal ohne
Anmeldung prüfen, dass alles wieder da ist.

## Kleinigkeiten, die sich lohnen

```bash
# Ein sprechender Name im Netz – der Mac heißt dann klappe-server.local.
sudo scutil --set ComputerName klappe-server
sudo scutil --set LocalHostName klappe-server
sudo scutil --set HostName klappe-server

# Spotlight hat im Medienordner nichts zu suchen – das Indizieren von
# Kamerabändern kostet nur Platte und CPU.
sudo mdutil -i off /Users/dein-benutzer/klappe-media
```

## Den Ernstfall einmal proben

Der einzige Beweis, dass die Kette hält, ist der Versuch: einmal hart den
Stecker ziehen (oder wenigstens `sudo reboot`) und dann **ohne** Tastatur
und Monitor abwarten, bis alles wieder da ist:

```bash
ssh dein-benutzer@klappe-server.local
docker ps                                    # alle fünf Dienste laufen?
sudo launchctl print system/de.fuhrzwei.klappe-worker | grep state
tail -5 ~/Library/Logs/klappe-worker.log     # „Video-Encoder: h264_videotoolbox“?
```

Dazu im Browser anmelden und eine kleine Datei hochladen. Erst wenn das
alles ohne Zutun funktioniert, ist der Mac ein Server.
