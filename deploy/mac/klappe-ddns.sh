#!/usr/bin/env bash
#
# Den A-Eintrag bei Cloudflare auf die aktuelle öffentliche IPv4 nachführen.
#
#   ./deploy/mac/klappe-ddns.sh          # einmal nachsehen und ggf. setzen
#   ./deploy/mac/klappe-ddns.sh --pruefen # nur berichten, nichts ändern
#
# Warum es das gibt: Wird Klappe direkt angebunden statt über den
# Cloudflare-Tunnel, zeigt ein A-Eintrag auf den Anschluss – und der bekommt
# bei jedem Reconnect eine neue Adresse. Ohne Nachführung zeigt der Name dann
# ins Leere, und zwar so lange, bis es jemandem auffällt.
#
# Die FRITZ!Box kann das nicht selbst übernehmen: Ihr „benutzerdefiniertes"
# DynDNS schickt ein schlichtes GET mit Platzhaltern in der Adresse, während
# die Cloudflare-API ein PATCH mit JSON-Rumpf und einem Bearer-Kopf verlangt.
# Methode und Kopfzeilen kann die FRITZ!Box nicht setzen.
#
# Der Preis dieser Lösung ist eine Minute: Zwischen Reconnect und Nachführung
# vergeht höchstens ein Durchlauf. Bei einer TTL von 60 Sekunden heißt das im
# schlimmsten Fall gut zwei Minuten, in denen der Name veraltet ist.
set -euo pipefail

# ---------------------------------------------------------------- Zugangsdaten
#
# **Hier kommt das API-Token hin – aber nicht in diese Datei.**
#
# Erwartet wird eine Datei mit den vier Werten, die nur dem Eigentümer lesbar
# ist. Anlegen mit:
#
#   mkdir -p ~/.config/klappe-ddns
#   cp deploy/mac/klappe-ddns.env.beispiel ~/.config/klappe-ddns/env
#   chmod 600 ~/.config/klappe-ddns/env
#   # danach ~/.config/klappe-ddns/env im Editor ausfüllen
#
# Bewusst getrennt vom Skript und vom launchd-Eintrag: Der liegt systemweit
# lesbar unter ~/Library/LaunchAgents, und ein Token, das dort steht, kann
# jeder Prozess auf dem Rechner mitlesen. Dieselbe Falle steht als Warnung
# schon im Worker-Dienst.
KONFIG="${KLAPPE_DDNS_ENV:-$HOME/.config/klappe-ddns/env}"

PROTOKOLL="${KLAPPE_DDNS_LOG:-$HOME/Library/Logs/klappe-ddns.log}"
STAND="${KLAPPE_DDNS_STATE:-$HOME/.config/klappe-ddns/zuletzt}"

# Auch ohne Änderung wird ab und zu bei Cloudflare nachgefragt – falls jemand
# den Eintrag im Dashboard von Hand verstellt hat, fällt das sonst nie auf.
VOLLPRUEFUNG_SEKUNDEN=1800

NUR_PRUEFEN=""
[[ "${1:-}" == "--pruefen" ]] && NUR_PRUEFEN="ja"

melde() {
  printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" | tee -a "$PROTOKOLL"
}

fehler() {
  melde "FEHLER: $1"
  exit 1
}

mkdir -p "$(dirname "$PROTOKOLL")" "$(dirname "$STAND")"

[[ -f "$KONFIG" ]] || fehler "Es gibt keine $KONFIG – siehe Kopf dieser Datei."

# Ein Token in einer Datei, die alle lesen dürfen, ist kein Geheimnis mehr.
RECHTE="$(stat -f '%OLp' "$KONFIG")"
if [[ "$RECHTE" != "600" ]]; then
  fehler "$KONFIG ist mit $RECHTE lesbar. Bitte 'chmod 600 $KONFIG'."
fi

# shellcheck source=/dev/null
source "$KONFIG"

: "${CF_API_TOKEN:?CF_API_TOKEN fehlt in $KONFIG}"
: "${CF_ZONE:?CF_ZONE fehlt in $KONFIG (z. B. beispiel.de)}"
: "${CF_RECORD:?CF_RECORD fehlt in $KONFIG (z. B. medien.beispiel.de)}"
CF_TTL="${CF_TTL:-60}"

# --------------------------------------------------------------- eigene Adresse
#
# Zwei Quellen, weil eine davon irgendwann nicht antwortet – und ein Ausfall
# soll nicht dazu führen, dass gar nichts mehr nachgeführt wird.
#
# `-4` ist Pflicht: Der Anschluss hat auch IPv6, und ohne die Einschränkung
# käme eine v6-Adresse zurück, die in einem A-Eintrag nichts verloren hat.
eigene_ip() {
  local ip
  ip="$(curl -4 -s -m 10 https://cloudflare.com/cdn-cgi/trace | awk -F= '/^ip=/{print $2}')" || true
  [[ -n "$ip" ]] || ip="$(curl -4 -s -m 10 https://api.ipify.org)" || true
  printf '%s' "$ip"
}

ist_ipv4() {
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  local teil
  for teil in ${1//./ }; do ((teil <= 255)) || return 1; done
  return 0
}

IP="$(eigene_ip)"
# Ohne Prüfung könnte eine Fehlerseite oder ein leerer Rumpf als „Adresse" in
# den Eintrag wandern – und der Name zeigte danach garantiert ins Leere.
ist_ipv4 "$IP" || fehler "Keine brauchbare IPv4 bekommen (»${IP:-leer}«)."

# --------------------------------------------------------- kurzer Weg: nichts zu tun
#
# Im Normalfall ändert sich tagelang nichts. Dann soll dieser Lauf weder die
# API belästigen noch das Protokoll vollschreiben.
ZULETZT=""; ZULETZT_AM=0
if [[ -f "$STAND" ]]; then
  ZULETZT="$(awk 'NR==1{print $1}' "$STAND")"
  ZULETZT_AM="$(awk 'NR==1{print $2+0}' "$STAND")"
fi
JETZT="$(date +%s)"

if [[ -n "$NUR_PRUEFEN" ]]; then
  melde "Öffentliche IPv4: $IP · zuletzt gesetzt: ${ZULETZT:-nie}"
fi

if [[ "$IP" == "$ZULETZT" && $((JETZT - ZULETZT_AM)) -lt $VOLLPRUEFUNG_SEKUNDEN ]]; then
  [[ -n "$NUR_PRUEFEN" ]] && melde "Unverändert – nichts zu tun."
  exit 0
fi

# ------------------------------------------------------------------ Cloudflare
cf() {
  local methode="$1" pfad="$2" rumpf="${3:-}"
  local -a argumente=(-s -m 20 -X "$methode"
    -H "Authorization: Bearer $CF_API_TOKEN"
    -H "Content-Type: application/json")
  [[ -n "$rumpf" ]] && argumente+=(--data "$rumpf")
  curl "${argumente[@]}" "https://api.cloudflare.com/client/v4${pfad}"
}

# Aus einer Antwort ein Feld holen, ohne von `jq` abzuhängen – auf einem
# frischen Mac ist das nicht installiert, und eine Abhängigkeit für drei
# Felder lohnt nicht.
feld() {
  /usr/bin/python3 -c 'import json,sys
daten = json.load(sys.stdin)
if not daten.get("success"):
    fehler = daten.get("errors") or [{"message": "unbekannter Fehler"}]
    # Mit Zeilenumbruch, sonst klebt Cloudflares Begründung an der Meldung,
    # die der Aufrufer gleich darunter schreibt.
    sys.stderr.write("  Cloudflare sagt: " + "; ".join(f.get("message", "?") for f in fehler) + "\n")
    sys.exit(3)
treffer = daten.get("result") or []
if isinstance(treffer, dict):
    treffer = [treffer]
if not treffer:
    sys.exit(4)
print(treffer[0].get(sys.argv[1], ""))' "$1"
}

ANTWORT="$(cf GET "/zones?name=${CF_ZONE}")"
ZONE_ID="$(printf '%s' "$ANTWORT" | feld id)" || fehler "Zone $CF_ZONE nicht gefunden. Darf das Token diese Zone?"

ANTWORT="$(cf GET "/zones/${ZONE_ID}/dns_records?type=A&name=${CF_RECORD}")"
if RECORD_ID="$(printf '%s' "$ANTWORT" | feld id 2>/dev/null)"; then
  BISHER="$(printf '%s' "$ANTWORT" | feld content)"
else
  RECORD_ID=""
  BISHER=""
fi

if [[ -n "$NUR_PRUEFEN" ]]; then
  melde "Bei Cloudflare steht: ${BISHER:-kein A-Eintrag}"
  [[ "$BISHER" == "$IP" ]] && melde "Stimmt überein." || melde "WEICHT AB – ein echter Lauf würde setzen."
  exit 0
fi

if [[ "$BISHER" == "$IP" ]]; then
  # Gleichstand: Nur den Stand auffrischen, damit die Vollprüfung wieder
  # eine halbe Stunde Ruhe gibt.
  printf '%s %s\n' "$IP" "$JETZT" > "$STAND"
  exit 0
fi

# `proxied: false` ist der ganze Punkt der Übung – mit oranger Wolke liefe der
# Verkehr wieder durch Cloudflare, und genau davon wollen wir ja weg.
RUMPF="$(/usr/bin/python3 -c 'import json,sys
print(json.dumps({"type": "A", "name": sys.argv[1], "content": sys.argv[2],
                  "ttl": int(sys.argv[3]), "proxied": False}))' "$CF_RECORD" "$IP" "$CF_TTL")"

if [[ -n "$RECORD_ID" ]]; then
  cf PATCH "/zones/${ZONE_ID}/dns_records/${RECORD_ID}" "$RUMPF" | feld id >/dev/null \
    || fehler "Cloudflare hat die Änderung abgelehnt."
  melde "$CF_RECORD: ${BISHER:-?} → $IP"
else
  cf POST "/zones/${ZONE_ID}/dns_records" "$RUMPF" | feld id >/dev/null \
    || fehler "Cloudflare hat den neuen Eintrag abgelehnt."
  melde "$CF_RECORD neu angelegt mit $IP"
fi

printf '%s %s\n' "$IP" "$JETZT" > "$STAND"
