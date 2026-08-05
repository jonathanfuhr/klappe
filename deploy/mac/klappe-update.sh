#!/usr/bin/env bash
#
# Klappe auf einem Mac-Server aktualisieren – in einem Befehl.
#
#   ./deploy/mac/klappe-update.sh
#
# Der Mac ist der eine Aufbau, bei dem nicht alles im Container läuft: Docker
# kennt Apples Hardware-Encoder nicht, deshalb läuft der Worker nativ unter
# launchd (siehe docker-compose.mac.yml). Ein Update hat damit zwei Hälften,
# und genau das ist die Falle – die Container waren aktuell, der Worker lief
# tagelang mit altem Stand weiter, und niemand sah es.
#
# Der häufigste Grund dafür war ein vergessenes `npm install`: Kommt mit einer
# Version eine neue Abhängigkeit dazu, scheitert der Build daran, das alte
# `dist/` bleibt liegen, und der Worker startet fröhlich damit. Deshalb
# bricht dieses Skript bei jedem Fehler sofort ab (`set -e`) und meldet am
# Ende ausdrücklich, was läuft.
#
# Was es tut:
#   1. Stand holen (git pull)
#   2. Abhängigkeiten nachziehen (npm ci)
#   3. Server bauen (shared + api → dist)
#   4. Container neu bauen und starten – die Datenbank-Migration läuft dabei
#      im Start des api-Containers mit
#   5. Den nativen Worker neu starten
#   6. Prüfen und berichten
set -euo pipefail

# Immer aus dem Repo heraus arbeiten, egal von wo aufgerufen.
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

BLAU=$'\033[1;34m'; GRUEN=$'\033[0;32m'; GELB=$'\033[0;33m'; ROT=$'\033[0;31m'; AUS=$'\033[0m'
schritt() { printf '\n%s==> %s%s\n' "$BLAU" "$1" "$AUS"; }
gut()     { printf '%s    %s%s\n' "$GRUEN" "$1" "$AUS"; }
warn()    { printf '%s    %s%s\n' "$GELB" "$1" "$AUS"; }
fehler()  { printf '%s    %s%s\n' "$ROT" "$1" "$AUS"; }

# Die Compose-Dateien dieses Aufbaus. Weitere Overlays (tunnel, https) lassen
# sich über KLAPPE_COMPOSE_EXTRA ergänzen, z. B.:
#   KLAPPE_COMPOSE_EXTRA="-f docker-compose.https.yml" ./deploy/mac/klappe-update.sh
COMPOSE=(-f docker-compose.yml -f docker-compose.mac.yml)
if [[ -n "${KLAPPE_COMPOSE_EXTRA:-}" ]]; then
  # Absichtlich ohne Anführungszeichen: Die Variable trägt mehrere Wörter.
  # shellcheck disable=SC2206
  COMPOSE+=(${KLAPPE_COMPOSE_EXTRA})
fi

WORKER_LABEL='de.fuhrzwei.klappe-worker'
WORKER_MUSTER='apps/api/dist/worker.js'

# ---------------------------------------------------------------- 1. Stand holen
schritt "Stand holen"
if [[ -n "$(git status --porcelain)" ]]; then
  warn "Es liegen lokale Änderungen im Repo:"
  git status --short | sed 's/^/      /'
  warn "Sie bleiben erhalten; git pull bricht ab, falls sie im Weg sind."
fi
VORHER="$(git rev-parse HEAD)"
git pull --ff-only
NACHHER="$(git rev-parse HEAD)"
if [[ "$VORHER" == "$NACHHER" ]]; then
  gut "Schon aktuell ($(git log --oneline -1))"
else
  gut "Aktualisiert: $(git log --oneline -1)"
  git --no-pager log --oneline "$VORHER..$NACHHER" | sed 's/^/      /'
fi

# ------------------------------------------------------- 2. Abhängigkeiten
# `npm ci` statt `npm install`: Es hält sich strikt an package-lock.json und
# lässt keinen halb aktualisierten Baum zurück. Das ist der Schritt, dessen
# Fehlen den Worker zuletzt vier Tage auf altem Stand hielt.
schritt "Abhängigkeiten"
npm ci --no-audit --no-fund
gut "Vollständig"

# --------------------------------------------------------------- 3. Server bauen
schritt "Server bauen (shared + api)"
npm run build:server
gut "dist/ ist neu"

# ------------------------------------------------------------------ 4. Container
# `--build` erzwingt ein neues Image; ohne das liefe der alte Stand weiter.
# Die Datenbank-Migration läuft im Startskript des api-Containers mit.
schritt "Container bauen und starten"
docker compose "${COMPOSE[@]}" up -d --build
gut "Gestartet"

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

# --------------------------------------------------------------- 5. Worker neu
# Beenden genügt: launchd startet ihn wegen KeepAlive von selbst neu, und weil
# der Prozess unter demselben Benutzer läuft, braucht es dafür kein sudo.
schritt "Worker neu starten"
ALT="$(pgrep -f "$WORKER_MUSTER" | head -1 || true)"
if [[ -n "$ALT" ]]; then
  kill "$ALT" 2>/dev/null || true
  gut "Alter Prozess ($ALT) beendet – launchd startet neu"
else
  warn "Es lief kein Worker. launchd sollte ihn gleich starten;"
  warn "falls nicht: sudo launchctl kickstart -k system/$WORKER_LABEL"
fi

NEU=""
for _ in $(seq 1 15); do
  sleep 2
  NEU="$(pgrep -f "$WORKER_MUSTER" | head -1 || true)"
  [[ -n "$NEU" && "$NEU" != "$ALT" ]] && break
done

# ------------------------------------------------------------------ 6. Bericht
schritt "Stand"
docker compose "${COMPOSE[@]}" ps --format '    {{.Name}}  {{.Status}}' 2>/dev/null || true

if [[ -n "$NEU" && "$NEU" != "$ALT" ]]; then
  gut "Worker läuft neu (PID $NEU)"
else
  fehler "Worker ist nicht wieder hochgekommen."
  fehler "Nachsehen: tail -30 ~/Library/Logs/klappe-worker.err.log"
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

printf '\n%sFertig: %s%s\n\n' "$GRUEN" "$(git log --oneline -1)" "$AUS"
