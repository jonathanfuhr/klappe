#!/usr/bin/env bash
#
# Die A-Einträge bei Cloudflare auf die aktuelle öffentliche IPv4 nachführen.
#
#   ./deploy/mac/klappe-ddns.sh          # einmal nachsehen und ggf. setzen
#   ./deploy/mac/klappe-ddns.sh --pruefen # nur berichten, nichts ändern
#
# Warum es das gibt: Wird Klappe direkt angebunden statt über den
# Cloudflare-Tunnel, zeigt ein A-Eintrag auf den Anschluss – und der bekommt
# bei jedem Reconnect eine neue Adresse. Ohne Nachführung zeigt der Name dann
# ins Leere, und zwar so lange, bis es jemandem auffällt.
#
# **Mehrere Namen.** Hinter dem Reverse Proxy steht nicht nur Klappe; Preroll
# und was noch dazukommt hängen am selben Anschluss und teilen sich damit
# genau dieselbe Adresse. Deshalb nimmt `CF_RECORD` eine Liste. Ein zweiter
# Zeitplan mit einem zweiten Skript wäre dieselbe Arbeit doppelt – und der
# zweite bliebe beim nächsten Umbau zurück.
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

# Getrennt durch Leerzeichen oder Komma – beides schreibt sich jemand
# irgendwann hin, und an einem Trennzeichen soll das nicht scheitern.
read -r -a NAMEN <<< "${CF_RECORD//,/ }"
((${#NAMEN[@]} > 0)) || fehler "CF_RECORD ist leer."

# Der Schlüssel wandert mit in die Standdatei: Kommt ein Name dazu, stimmt
# der gespeicherte Stand nicht mehr, und der nächste Lauf sieht wirklich nach
# – statt den neuen Namen bis zur nächsten Vollprüfung zu übergehen.
NAMEN_SCHLUESSEL="$(printf '%s,' "${NAMEN[@]}")"

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
ZULETZT=""; ZULETZT_AM=0; ZULETZT_NAMEN=""
if [[ -f "$STAND" ]]; then
  ZULETZT="$(awk 'NR==1{print $1}' "$STAND")"
  ZULETZT_AM="$(awk 'NR==1{print $2+0}' "$STAND")"
  ZULETZT_NAMEN="$(awk 'NR==1{print $3}' "$STAND")"
fi
JETZT="$(date +%s)"

if [[ -n "$NUR_PRUEFEN" ]]; then
  melde "Öffentliche IPv4: $IP · zuletzt gesetzt: ${ZULETZT:-nie} · Namen: ${NAMEN[*]}"
fi

if [[ "$IP" == "$ZULETZT" && "$NAMEN_SCHLUESSEL" == "$ZULETZT_NAMEN" &&
      $((JETZT - ZULETZT_AM)) -lt $VOLLPRUEFUNG_SEKUNDEN ]]; then
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

# ------------------------------------------------------------- ein Name
#
# Gibt 0 zurück, wenn danach alles steht. Bewusst **kein** `fehler` hier
# drin: Das beendete das ganze Skript, und ein Name, an dem etwas klemmt,
# hielte damit die übrigen auf – ausgerechnet in dem Moment, in dem sie eine
# neue Adresse brauchen.
fuehre_nach() {
  local name="$1"
  local antwort record_id bisher bisher_ttl bisher_proxy stimmt rumpf grund

  antwort="$(cf GET "/zones/${ZONE_ID}/dns_records?type=A&name=${name}")"
  if record_id="$(printf '%s' "$antwort" | feld id 2>/dev/null)"; then
    bisher="$(printf '%s' "$antwort" | feld content)"
    bisher_ttl="$(printf '%s' "$antwort" | feld ttl)"
    bisher_proxy="$(printf '%s' "$antwort" | feld proxied)"
  else
    record_id=""
    bisher=""
    bisher_ttl=""
    bisher_proxy=""
  fi

  # Nicht nur die Adresse zählt.
  #
  # Die orange Wolke lässt sich im Dashboard mit einem Klick einschalten, und
  # dann liefe der Verkehr wieder durch Cloudflare – also genau das, wovon der
  # ganze Aufbau wegwill. Ein Skript, das nur die Adresse vergleicht, merkte das
  # nie: Die stimmt ja weiterhin. Dasselbe für die TTL, die als „automatisch"
  # (`ttl: 1`) fünf Minuten bedeutet und damit zu lang ist für einen Anschluss,
  # dessen Adresse wechselt.
  stimmt="ja"
  [[ "$bisher" == "$IP" ]] || stimmt=""
  [[ "$bisher_ttl" == "$CF_TTL" ]] || stimmt=""
  [[ "$bisher_proxy" == "False" ]] || stimmt=""

  if [[ -n "$NUR_PRUEFEN" ]]; then
    melde "$name: ${bisher:-kein A-Eintrag} · TTL ${bisher_ttl:-–} · durch Cloudflare geleitet: ${bisher_proxy:-–}"
    if [[ -n "$stimmt" ]]; then
      melde "  wie gewünscht."
    else
      melde "  WEICHT AB – ein echter Lauf würde auf $IP · TTL $CF_TTL · grau setzen."
    fi
    return 0
  fi

  [[ -n "$stimmt" ]] && return 0

  # `proxied: false` ist der ganze Punkt der Übung – mit oranger Wolke liefe der
  # Verkehr wieder durch Cloudflare, und genau davon wollen wir ja weg.
  rumpf="$(/usr/bin/python3 -c 'import json,sys
print(json.dumps({"type": "A", "name": sys.argv[1], "content": sys.argv[2],
                  "ttl": int(sys.argv[3]), "proxied": False}))' "$name" "$IP" "$CF_TTL")"

  if [[ -n "$record_id" ]]; then
    if ! cf PATCH "/zones/${ZONE_ID}/dns_records/${record_id}" "$rumpf" | feld id >/dev/null; then
      melde "FEHLER: $name – Cloudflare hat die Änderung abgelehnt."
      return 1
    fi
    # Ausdrücklich benennen, was sich geändert hat – „Eintrag aktualisiert" im
    # Protokoll hilft niemandem, der später wissen will, warum.
    grund=""
    [[ "$bisher" == "$IP" ]] || grund="Adresse ${bisher:-?} → $IP"
    [[ "$bisher_ttl" == "$CF_TTL" ]] || grund="${grund:+$grund, }TTL ${bisher_ttl:-?} → $CF_TTL"
    [[ "$bisher_proxy" == "False" ]] || grund="${grund:+$grund, }von orange auf grau"
    melde "$name: $grund"
  else
    if ! cf POST "/zones/${ZONE_ID}/dns_records" "$rumpf" | feld id >/dev/null; then
      # Der häufigste Grund ist ein CNAME desselben Namens – etwa der
      # Tunnel-Eintrag, von dem gerade weggezogen wird. Cloudflare lässt
      # beides nebeneinander nicht zu.
      melde "FEHLER: $name – Cloudflare hat den neuen Eintrag abgelehnt. Steht dort noch ein CNAME?"
      return 1
    fi
    melde "$name neu angelegt mit $IP"
  fi

  return 0
}

# Ein misslungener Name soll die anderen nicht aufhalten, aber auch nicht
# stillschweigend durchgehen: Der Rückgabewert des Laufs sagt es, und mit ihm
# steht es im Fehlerprotokoll des LaunchAgents.
SCHIEF=0
for NAME in "${NAMEN[@]}"; do
  fuehre_nach "$NAME" || SCHIEF=1
done

if [[ -n "$NUR_PRUEFEN" ]]; then
  exit 0
fi

# Der Stand wird nur aufgefrischt, wenn alle Namen stehen. Sonst gälte nach
# einem halb geglückten Lauf eine halbe Stunde Ruhe – und der Name, an dem es
# klemmte, bliebe so lange falsch.
if ((SCHIEF == 0)); then
  printf '%s %s %s\n' "$IP" "$JETZT" "$NAMEN_SCHLUESSEL" > "$STAND"
fi

exit "$SCHIEF"
