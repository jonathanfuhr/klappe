#!/usr/bin/env bash
#
# Klappe auf einem Mac-Server aufsetzen und aktualisieren – in einem Befehl.
#
#   ./deploy/mac/klappe-deploy.sh
#
# Derselbe Befehl für beides. Beim ersten Lauf fehlen `.env` und der
# launchd-Dienst; das Skript legt sie an. Danach ist jeder weitere Lauf ein
# Update: Stand holen, Abhängigkeiten, Bauen, Container, Worker.
#
# Warum es das überhaupt gibt: Der Mac ist der eine Aufbau, bei dem nicht
# alles im Container läuft – Docker kennt Apples Hardware-Encoder nicht,
# deshalb läuft der Worker nativ unter launchd (siehe docker-compose.mac.yml).
# Ein Update hat damit zwei Hälften, und genau das ist die Falle: Die
# Container waren aktuell, der Worker lief vier Tage mit altem Stand weiter,
# und niemand sah es. Ursache war ein vergessenes `npm ci` – eine neue
# Abhängigkeit fehlte, der Build scheiterte, das alte `dist/` blieb liegen.
#
# Deshalb bricht dieses Skript bei jedem Fehler sofort ab (`set -e`) und sagt
# am Ende ausdrücklich, was läuft.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

BLAU=$'\033[1;34m'; GRUEN=$'\033[0;32m'; GELB=$'\033[0;33m'; ROT=$'\033[0;31m'; AUS=$'\033[0m'
schritt() { printf '\n%s==> %s%s\n' "$BLAU" "$1" "$AUS"; }
gut()     { printf '%s    %s%s\n' "$GRUEN" "$1" "$AUS"; }
warn()    { printf '%s    %s%s\n' "$GELB" "$1" "$AUS"; }
fehler()  { printf '%s    %s%s\n' "$ROT" "$1" "$AUS"; }

COMPOSE=(-f docker-compose.yml -f docker-compose.mac.yml)
if [[ -n "${KLAPPE_COMPOSE_EXTRA:-}" ]]; then
  # Absichtlich ohne Anführungszeichen: Die Variable trägt mehrere Wörter.
  # shellcheck disable=SC2206
  COMPOSE+=(${KLAPPE_COMPOSE_EXTRA})
fi

WORKER_LABEL='de.fuhrzwei.klappe-worker'
WORKER_PLIST="/Library/LaunchDaemons/${WORKER_LABEL}.plist"
WORKER_MUSTER='apps/api/dist/worker.js'
VORLAGE='deploy/mac/de.fuhrzwei.klappe-worker.plist'

# Liest einen Wert aus der .env – ohne sie einzubinden, damit nichts
# ausgeführt wird, was zufällig darin steht.
env_wert() {
  local schluessel="$1"
  [[ -f .env ]] || return 0
  sed -n "s/^${schluessel}=//p" .env | tail -1 | sed 's/^["'\'']//;s/["'\'']$//'
}

# ------------------------------------------------------- 0. Erstlauf erkennen
ERSTLAUF=""
[[ -f .env && -f "$WORKER_PLIST" ]] || ERSTLAUF="ja"

if [[ -n "$ERSTLAUF" ]]; then
  schritt "Erster Lauf – Klappe wird eingerichtet"
  [[ -f .env ]] || warn "Es gibt noch keine .env"
  [[ -f "$WORKER_PLIST" ]] || warn "Der Worker-Dienst ist noch nicht installiert"
fi

# --------------------------------------------------------------------- 1. .env
if [[ ! -f .env ]]; then
  schritt ".env anlegen"
  cp .env.example .env
  chmod 600 .env

  # Die beiden Geheimnisse erzeugt das Skript selbst – von Hand gesetzte sind
  # erfahrungsgemäß entweder schwach oder bleiben auf dem Beispielwert stehen.
  PG_PW="$(openssl rand -hex 24)"
  JWT="$(openssl rand -hex 32)"
  # `|` als Trenner: In den Werten kommen keine Pipes vor, Schrägstriche schon.
  sed -i '' "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PW}|" .env
  sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" .env
  gut "Erzeugt, mit frischem POSTGRES_PASSWORD und JWT_SECRET (Rechte 600)"

  printf '\n'
  warn "Bitte jetzt in der .env prüfen und anpassen:"
  warn "  PUBLIC_URL   – die Adresse, unter der Klappe erreichbar ist."
  warn "                 Sie steht in jedem Freigabe-Link und in jeder Mail."
  warn "  MEDIA_DIR    – ein echter Pfad auf diesem Mac, kein Docker-Volume:"
  warn "                 Der native Worker braucht denselben Medienbaum wie die API."
  printf '\n'
  warn "Danach dasselbe Skript noch einmal starten."
  exit 0
fi

MEDIA_DIR="$(env_wert MEDIA_DIR)"
PUBLIC_URL="$(env_wert PUBLIC_URL)"
POSTGRES_PASSWORD="$(env_wert POSTGRES_PASSWORD)"
JWT_SECRET="$(env_wert JWT_SECRET)"

for pflicht in MEDIA_DIR PUBLIC_URL POSTGRES_PASSWORD JWT_SECRET; do
  if [[ -z "${!pflicht}" ]]; then
    fehler "In der .env fehlt $pflicht."
    exit 1
  fi
done

if [[ "$MEDIA_DIR" != /* ]]; then
  fehler "MEDIA_DIR muss ein absoluter Pfad auf diesem Mac sein (aktuell: $MEDIA_DIR)."
  fehler "Ein benanntes Docker-Volume liegt in der Linux-VM und ist für den"
  fehler "nativen Worker unsichtbar – er schriebe ins Leere."
  exit 1
fi
mkdir -p "$MEDIA_DIR"

# ------------------------------------------------------------------ 2. Stand
schritt "Stand holen"
if [[ -n "$(git status --porcelain)" ]]; then
  warn "Es liegen lokale Änderungen im Repo:"
  git status --short | sed 's/^/      /'
  warn "Sie bleiben erhalten; git pull bricht ab, falls sie im Weg sind."
fi
if git rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
  VORHER="$(git rev-parse HEAD)"
  git pull --ff-only
  NACHHER="$(git rev-parse HEAD)"
  if [[ "$VORHER" == "$NACHHER" ]]; then
    gut "Schon aktuell ($(git log --oneline -1))"
  else
    gut "Aktualisiert: $(git log --oneline -1)"
    git --no-pager log --oneline "$VORHER..$NACHHER" | sed 's/^/      /'
  fi
else
  warn "Kein Upstream gesetzt – übersprungen. Stand: $(git log --oneline -1)"
fi

# --------------------------------------------------------- 3. Abhängigkeiten
# `npm ci` statt `npm install`: Es hält sich strikt an package-lock.json und
# lässt keinen halb aktualisierten Baum zurück. Das ist der Schritt, dessen
# Fehlen den Worker zuletzt vier Tage auf altem Stand hielt.
schritt "Abhängigkeiten"
npm ci --no-audit --no-fund
gut "Vollständig"

# ------------------------------------------------------------------ 4. Bauen
schritt "Server bauen (shared + api)"
npm run build:server
gut "dist/ ist neu"

# ---------------------------------------------------------- 5. Worker-Dienst
if [[ ! -f "$WORKER_PLIST" ]]; then
  schritt "Worker-Dienst einrichten"
  warn "Dafür wird einmalig das Administrator-Passwort gebraucht:"
  warn "Der Dienst gehört nach /Library/LaunchDaemons und startet damit"
  warn "schon beim Hochfahren, ohne dass sich jemand anmelden muss."

  ENTWURF="$(mktemp -t klappe-worker).plist"
  cp "$VORLAGE" "$ENTWURF"

  # Gesetzt wird mit `plutil` und nicht mit `sed`: Eine plist ist XML, und ein
  # Suchen-und-Ersetzen darin trifft entweder zu viel oder – schlimmer – zu
  # wenig. Genau das ist beim Bauen passiert: Die Vorlage trug
  # `klappe.example.org`, gesucht wurde `.de`, und PUBLIC_URL blieb still auf
  # dem Beispielwert stehen. `plutil` spricht Schlüssel an, nicht Zeichen.
  plutil -replace WorkingDirectory -string "$(pwd)" "$ENTWURF"
  plutil -replace UserName -string "$(whoami)" "$ENTWURF"
  plutil -replace StandardOutPath -string "${HOME}/Library/Logs/klappe-worker.log" "$ENTWURF"
  plutil -replace StandardErrorPath -string "${HOME}/Library/Logs/klappe-worker.err.log" "$ENTWURF"
  plutil -replace EnvironmentVariables.STORAGE_DIR -string "$MEDIA_DIR" "$ENTWURF"
  plutil -replace EnvironmentVariables.PUBLIC_URL -string "$PUBLIC_URL" "$ENTWURF"
  plutil -replace EnvironmentVariables.JWT_SECRET -string "$JWT_SECRET" "$ENTWURF"
  plutil -replace EnvironmentVariables.DATABASE_URL \
    -string "postgres://klappe:${POSTGRES_PASSWORD}@127.0.0.1:5432/klappe" "$ENTWURF"

  # Node liegt nicht überall gleich; die Vorlage rät auf node@22. Ersetzt wird
  # das **ganze** Array: `-replace ProgramArguments.0` fügt bei plutil ein
  # Element ein, statt das erste zu überschreiben – der Worker bekäme dann den
  # Pfad zu node als Argument und liefe nie an (im Trockenlauf gesehen).
  NODE_BIN="$(command -v node || true)"
  if [[ -n "$NODE_BIN" ]]; then
    plutil -replace ProgramArguments \
      -json "[\"${NODE_BIN}\", \"apps/api/dist/worker.js\"]" "$ENTWURF"
  fi

  # Zwei Netze: Ist die Datei kein gültiges plist, lehnt launchd sie
  # kommentarlos ab – und ein übersehener Platzhalter fällt sonst erst auf,
  # wenn der Worker ins Leere schreibt.
  if ! plutil -lint "$ENTWURF" >/dev/null; then
    fehler "Die erzeugte Dienst-Datei ist kein gültiges plist."
    rm -f "$ENTWURF"
    exit 1
  fi
  if plutil -p "$ENTWURF" | grep -q 'DEIN-BENUTZER\|POSTGRES-PASSWORT\|WIE-IN-DER-ENV\|example.org'; then
    fehler "In der erzeugten Dienst-Datei stehen noch Platzhalter:"
    plutil -p "$ENTWURF" | grep 'DEIN-BENUTZER\|POSTGRES-PASSWORT\|WIE-IN-DER-ENV\|example.org' | sed 's/^/      /'
    fehler "Bitte $VORLAGE von Hand anpassen und nach $WORKER_PLIST kopieren."
    rm -f "$ENTWURF"
    exit 1
  fi

  sudo install -o root -g wheel -m 0644 "$ENTWURF" "$WORKER_PLIST"
  rm -f "$ENTWURF"
  sudo launchctl bootstrap system "$WORKER_PLIST" 2>/dev/null || true
  gut "Dienst installiert und gestartet"
  # Die Geheimnisse stehen jetzt in einer Datei, die jeder lesen darf –
  # deshalb der ausdrückliche Hinweis statt stillschweigend weiter.
  warn "Hinweis: $WORKER_PLIST enthält Datenbankpasswort und JWT_SECRET"
  warn "und ist systemweit lesbar – so verlangt es launchd."
fi

# -------------------------------------------------------------- 6. Container
# `--build` erzwingt ein neues Image; ohne das liefe der alte Stand weiter.
# Die Datenbank-Migration läuft im Startskript des api-Containers mit.
schritt "Container bauen und starten"
# Commit und Bauzeitpunkt wandern ins Image und stehen danach in der
# Oberfläche unter „Über diese Software" (1.5.1). Im Container ist beides
# sonst nicht zu ermitteln – ein .git liegt dort nicht.
export KLAPPE_COMMIT="$(git rev-parse --short HEAD)"
export KLAPPE_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker compose "${COMPOSE[@]}" up -d --build
gut "Gestartet (Version $(node -p "require('./package.json').version"), Commit ${KLAPPE_COMMIT})"

schritt "Auf die API warten"
BEREIT=""
for _ in $(seq 1 60); do
  if docker compose "${COMPOSE[@]}" ps api --format '{{.Status}}' 2>/dev/null | grep -qi 'healthy'; then
    BEREIT="ja"; break
  fi
  sleep 2
done
if [[ -n "$BEREIT" ]]; then
  gut "API ist bereit – die Migration ist damit durch"
else
  warn "API meldet nach zwei Minuten kein 'healthy'. Weiter geht es trotzdem;"
  warn "bitte danach 'docker compose logs api' ansehen."
fi

# ------------------------------------------------------------- 7. Worker neu
# Beenden genügt: launchd startet ihn wegen KeepAlive von selbst neu, und weil
# der Prozess unter demselben Benutzer läuft, braucht es dafür kein sudo.
schritt "Worker neu starten"
ALT="$(pgrep -f "$WORKER_MUSTER" | head -1 || true)"
if [[ -n "$ALT" ]]; then
  kill "$ALT" 2>/dev/null || true
  gut "Alter Prozess ($ALT) beendet – launchd startet neu"
else
  warn "Es lief kein Worker – launchd sollte ihn gleich starten."
fi

NEU=""
for _ in $(seq 1 20); do
  sleep 2
  NEU="$(pgrep -f "$WORKER_MUSTER" | head -1 || true)"
  [[ -n "$NEU" && "$NEU" != "$ALT" ]] && break
done

# ---------------------------------------------------------------- 8. Bericht
schritt "Stand"
docker compose "${COMPOSE[@]}" ps --format '    {{.Name}}  {{.Status}}' 2>/dev/null || true

if [[ -n "$NEU" && "$NEU" != "$ALT" ]]; then
  gut "Worker läuft neu (PID $NEU)"
else
  fehler "Worker ist nicht wieder hochgekommen."
  fehler "Nachsehen: tail -30 ~/Library/Logs/klappe-worker.err.log"
  fehler "Notfalls: sudo launchctl kickstart -k system/$WORKER_LABEL"
  exit 1
fi

# Der Beweis, dass der Worker den frischen Build hat und nicht den alten:
# Ohne diese Zeile im Protokoll ist er zwar gestartet, aber möglicherweise mit
# dem, was vorher in dist/ lag.
sleep 3
if tail -40 ~/Library/Logs/klappe-worker.log 2>/dev/null | grep -q 'wartet auf Transcoding-Jobs'; then
  gut "Worker meldet sich betriebsbereit"
else
  warn "Keine Startmeldung im Protokoll gefunden – bitte kurz nachsehen:"
  warn "  tail -30 ~/Library/Logs/klappe-worker.log"
fi

printf '\n%sFertig: %s%s\n' "$GRUEN" "$(git log --oneline -1)" "$AUS"

if [[ -n "$ERSTLAUF" ]]; then
  printf '\n%sJetzt %s öffnen.%s\n' "$BLAU" "$PUBLIC_URL" "$AUS"
  printf '%sDort das erste Konto anlegen – es bekommt Administratorrechte.%s\n\n' "$BLAU" "$AUS"
else
  printf '\n'
fi
