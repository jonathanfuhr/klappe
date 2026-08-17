# Caddy mit dem Cloudflare-Modul für die DNS-Prüfung.
#
# Das offizielle Abbild bringt nur die eingebauten Wege mit (HTTP-01 und
# TLS-ALPN-01). Beide setzen voraus, dass Let's Encrypt den Server von außen
# **erreicht** – und genau das ist beim Umstieg vom Tunnel auf die eigene
# Leitung der wunde Punkt:
#
# - Solange der Name noch auf Cloudflare zeigt, landet die Prüfung dort und
#   nicht hier. Das Zertifikat ließe sich also erst *nach* dem Umschalten
#   holen, und bis es da ist, wäre die Seite unerreichbar.
# - Und später: Steht der Router einmal neu oder ist Port 443 gesperrt,
#   scheitert die Verlängerung – ohne dass es jemandem auffällt, bis das
#   Zertifikat abläuft.
#
# Über DNS-01 setzt Caddy einen TXT-Eintrag in der Zone und braucht dafür
# überhaupt keine eingehende Verbindung. Das Zertifikat liegt damit bereit,
# bevor umgeschaltet wird, und die Verlängerung hängt an nichts als der
# Cloudflare-API.
#
# Gebaut wird mit dem offiziellen Bauabbild – kein fremdes Fertigabbild, das
# irgendwann etwas anderes enthalten könnte als heute.
FROM caddy:2-builder AS builder

RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2-alpine

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
