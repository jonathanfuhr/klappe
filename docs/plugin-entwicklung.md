# Eigene Anbindungen bauen

Diese Seite richtet sich an alle, die etwas an Klappe anschließen wollen: ein
Plugin fürs Schnittprogramm, ein Skript, das nachts Fassungen hochlädt, eine
eigene App. Sie setzt keine Kenntnis des Klappe-Quelltextes voraus – nur die
Fähigkeit, HTTP-Anfragen zu stellen.

Die vollständige Liste aller Routen steht in [`api.md`](api.md). Hier steht,
wie man anfängt.

---

## Inhalt

- [Bevor es losgeht](#bevor-es-losgeht)
- [Sich verbinden](#sich-verbinden)
- [Die ersten Abfragen](#die-ersten-abfragen)
- [Kommentare in die Timeline](#kommentare-in-die-timeline)
- [Eine Fassung hochladen](#eine-fassung-hochladen)
- [Auf Änderungen warten](#auf-änderungen-warten)
- [Regeln des Hauses](#regeln-des-hauses)

---

## Bevor es losgeht

**Der Administrator muss den externen Zugriff freigeschaltet haben.**
Einstellungen → API-Zugriff → *Externen API-Zugriff erlauben*. Ab Werk steht
der Schalter auf aus; solange er das tut, antwortet jede Anfrage mit einem
`Authorization`-Header `403`, und auch das Verbinden schlägt fehl. Das ist
Absicht: Wer Klappe nur im Browser benutzt, soll keine zweite Tür offen haben,
von der er nichts weiß.

Was du brauchst:

- die Adresse der Anlage, z. B. `https://klappe.example.de`
- ein Konto darauf (Team **oder** Gast – ein Gast-Token trägt genau die
  Freigaben dieses Gastes)
- irgendeine Möglichkeit, HTTPS-Anfragen zu stellen

Was du **nicht** brauchst: einen Eintrag in einem Entwicklerportal, einen
API-Schlüssel vom Betreiber, eine Freischaltung deiner Anwendung. Es gibt keine
Registrierung von Anwendungen – jedes Programm koppelt sich selbst.

---

## Sich verbinden

Nimm ein Passwort-Formular in dein Plugin auf – und verwirf den Gedanken gleich
wieder. Es gäbe zwei Probleme: Das Passwort läge auf der Platte, und bei
Konten, die sich über Microsoft 365 anmelden, gibt es überhaupt kein Klappe-
Passwort einzutippen.

Stattdessen die **Gerätekopplung**. Der Ablauf ist der eines Fernsehers, den
man mit einem Streamingdienst verbindet:

```
 dein Plugin                     Mensch im Browser                  Klappe
     │  1. POST /v1/auth/geraet/start ─────────────────────────────────►│
     │◄──── deviceCode (geheim) + userCode „KHFP-3RTM" + Adresse ───────│
     │                                                                  │
     │  2. zeigt Code und Adresse an                                    │
     │                       ├── öffnet /geraet, ist angemeldet ───────►│
     │                       ├── sieht: „DaVinci Resolve will …"        │
     │                       └── bestätigt ────────────────────────────►│
     │                                                       Token entsteht
     │  3. POST /v1/auth/geraet/token ─────────────────────────────────►│
     │◄──── Token – genau einmal ───────────────────────────────────────│
```

### Schritt 1: Kopplung anmelden

```bash
curl -sX POST https://klappe.example.de/v1/auth/geraet/start \
  -H 'Content-Type: application/json' \
  -d '{"clientName":"DaVinci Resolve auf dem Schnittrechner"}'
```

```json
{
  "deviceCode": "kZ3n…43 Zeichen…",
  "userCode": "KHFP-3RTM",
  "verificationUrl": "https://klappe.example.de/geraet",
  "verificationUrlComplete": "https://klappe.example.de/geraet?code=KHFP-3RTM",
  "expiresInSeconds": 600,
  "intervalSeconds": 5
}
```

`clientName` ist das, was der Mensch beim Bestätigen liest und was später in
seiner Geräteliste steht. Sei konkret: „DaVinci Resolve" ist besser als „Plugin",
und „DaVinci Resolve auf dem Schnittrechner" ist noch besser – in der Liste
stehen irgendwann fünf Einträge.

### Schritt 2: bestätigen lassen

Zeig **beides** an: `userCode` groß und lesbar, dazu `verificationUrl`. Wenn
dein Programm einen Browser öffnen kann, nimm `verificationUrlComplete` – dann
muss niemand abtippen. Ein QR-Code darauf ist eine gute Idee, wenn der
Schnittplatz kein bequemes Browserfenster hat.

Bitte **nicht** die Bestätigung überspringen wollen. Sie ist der ganze Punkt:
Nur ein angemeldeter Mensch kann einem Programm seine Rechte geben.

### Schritt 3: Token abholen

Frag alle `intervalSeconds` nach – nicht öfter, sonst läuft dein Plugin in die
Bremse:

```bash
curl -sX POST https://klappe.example.de/v1/auth/geraet/token \
  -H 'Content-Type: application/json' \
  -d '{"deviceCode":"kZ3n…"}'
```

Solange niemand bestätigt hat:

```json
{ "pending": true }
```

Danach, **genau einmal**:

```json
{
  "token": "klp_a3f9x2m4qp71_hj28…",
  "name": "DaVinci Resolve auf dem Schnittrechner",
  "user": { "id": "…", "name": "Jonathan", "email": "…", "role": "ADMIN" }
}
```

| Antwort | Bedeutung | Was tun |
| --- | --- | --- |
| `200 { pending: true }` | noch niemand am Zug | weiter warten |
| `200 { token: … }` | fertig | Token speichern, aufhören zu fragen |
| `403` | abgelehnt – oder Zugriff abgeschaltet | aufhören, Meldung anzeigen |
| `400` | abgelaufen oder zu oft gefragt | von vorn beginnen |
| `404` | Gerätecode unbekannt | von vorn beginnen |

**Speichere den Token so sicher, wie deine Umgebung es hergibt** – Schlüsselbund
unter macOS, Credential Manager unter Windows, sonst eine Datei mit engen
Rechten. Er ist ein Ausweis, kein Konfigurationswert: nicht ins Projektarchiv,
nicht in ein Log, nicht in eine Datei, die mit dem Projekt weitergereicht wird.

### Danach

```
Authorization: Bearer klp_a3f9x2m4qp71_hj28…
```

Der Token läuft nicht ab. Er endet, wenn ihn jemand trennt: der Mensch selbst
unter *Mein Konto → Verbundene Geräte*, der Administrator in den Einstellungen,
oder indem der Administrator den API-Zugriff insgesamt abschaltet. Rechne
damit – siehe [Regeln des Hauses](#regeln-des-hauses).

---

## Die ersten Abfragen

Prüfen, ob der Token sitzt:

```bash
export KLAPPE=https://klappe.example.de
export TOKEN=klp_a3f9x2m4qp71_hj28…

curl -s "$KLAPPE/v1/auth/me" -H "Authorization: Bearer $TOKEN"
```

Die Hierarchie ist **Projekt → Video → Fassung**:

```bash
# Projekte
curl -s "$KLAPPE/v1/projects" -H "Authorization: Bearer $TOKEN"

# Videos eines Projekts, je mit neuester Fassung
curl -s "$KLAPPE/v1/projects/$PROJEKT/videos" -H "Authorization: Bearer $TOKEN"

# alle Fassungen eines Videos, neueste zuerst
curl -s "$KLAPPE/v1/videos/$VIDEO/versions" -H "Authorization: Bearer $TOKEN"
```

Die Antwortformen stehen als TypeScript-Typen in
`packages/shared/src/types.ts`. Wer in TypeScript baut, kann die Datei direkt
übernehmen – die Web-App benutzt exakt dieselben Typen, sie sind also
zwangsläufig aktuell.

---

## Kommentare in die Timeline

Der häufigste Wunsch, und der Grund, warum diese Schnittstelle offensteht.

```bash
curl -s "$KLAPPE/v1/versions/$FASSUNG/comments" -H "Authorization: Bearer $TOKEN"
```

Jeder Kommentar trägt **beides**:

```json
{
  "id": "…",
  "frame": 812,
  "timecode": "10:00:33:22",
  "body": "Hier bitte einen Frame früher schneiden",
  "author": { "name": "Anna Beispiel", "…": "…" },
  "resolved": false,
  "annotation": { "version": 1, "strokes": [] },
  "replies": [],
  "createdAt": "2026-03-04T09:12:00.000Z"
}
```

- **`frame`** ist der Bildindex, `0` ist das erste Bild. Das ist der Wert, den
  die meisten Schnitt-APIs wollen (`timeline.AddMarker(812, …)`).
- **`timecode`** ist SMPTE inklusive des Start-Timecodes der Kamera, in der
  Zählweise des Originals – Drop-Frame, wo es zutrifft. Das ist der Wert für
  alles, was mit dem Originalmaterial abgeglichen wird.

Beides kommt vom Server, damit niemand Framerate-Mathematik nachbauen muss:
Der Proxy trägt exakt die Framerate des Originals, Frame 812 im Player ist
Frame 812 im Schnittprogramm.

Fehlt `frame`, ist es ein allgemeiner Kommentar ohne Bildbezug – der gehört
nicht auf die Timeline. Antworten (`replies`) erben keinen Frame und hängen
immer am Wurzelkommentar; Threads sind eine Ebene tief.

Einen Kommentar schreiben:

```bash
curl -sX POST "$KLAPPE/v1/versions/$FASSUNG/comments" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"body":"Aus Resolve: Farbkorrektur ab hier prüfen","frame":812}'
```

Er erscheint unter dem Namen des gekoppelten Kontos – wie ein Kommentar aus dem
Browser. Ein Frame hinter dem Videoende wird mit `400` abgelehnt.

Erwähnungen im Text gehen als `@[Anzeigename](benutzer-id)`; der Server liest
die IDs heraus, prüft sie gegen aktive Konten und schickt die
Benachrichtigungen. Die IDs liefert `GET /v1/mentionable-users?q=`.

---

## Eine Fassung hochladen

Über **tus 1.0.0** – dasselbe Protokoll wie im Browser, und aus demselben
Grund: Ein 40-GB-Kameraband über VPN übersteht keine Verbindung am Stück.
Bricht sie ab, geht es an genau der Stelle weiter.

```bash
# 1. Sitzung eröffnen
curl -isX POST "$KLAPPE/v1/videos/$VIDEO/uploads" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"filename":"Teaser_v3.mov","sizeBytes":42949672960}'
# → 201, Location: /v1/uploads/<id>

# 2. Blöcke schreiben (wiederholbar)
curl -isX PATCH "$KLAPPE/v1/uploads/$UPLOAD" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/offset+octet-stream' \
  -H "Upload-Offset: 0" \
  --data-binary @block-0
# → 204, Upload-Offset: <neuer Stand>

# 3. Nach einem Abbruch: wo stehen wir?
curl -IsX HEAD "$KLAPPE/v1/uploads/$UPLOAD" -H "Authorization: Bearer $TOKEN"
# → Upload-Offset: <tatsächlicher Stand>
```

Beim letzten Block kommt zusätzlich `Klappe-Version-Id` zurück – ab da läuft
die Verarbeitung. Nimm eine fertige tus-Bibliothek, wenn es für deine Sprache
eine gibt; es gibt sie für die meisten.

Passt der `Upload-Offset` nicht zum Server, kommt `409` mit dem tatsächlichen
Stand in der Meldung – dann per `HEAD` nachsehen und dort weitermachen, nicht
von vorn beginnen.

Für Kundenmaterial statt einer Fassung: `POST /v1/projects/$PROJEKT/uploads`.

---

## Auf Änderungen warten

Es gibt **keine ausgehenden Webhooks**. Stattdessen einen Ereignisstrom über
Server-Sent Events:

```bash
curl -sN "$KLAPPE/v1/events" -H "Authorization: Bearer $TOKEN"
```

Was dort hinausgeht, ist bewusst inhaltslos – nur „an dieser Stelle hat sich
etwas getan". Die Daten holst du dir danach über die gewohnten,
rechtegeprüften Wege. Alle 25 Sekunden kommt ein `ping`; bleibt er aus, ist die
Leitung tot und gehört neu aufgebaut.

Wer lieber pollt: Projekte und Videos tragen `updatedAt`. Bitte in Maßen – eine
Anfrage je Sekunde je Plugin summiert sich auf einer Synology schnell.

---

## Regeln des Hauses

**Rechne jederzeit mit dem Entzug.** Ein Token kann zwischen zwei Anfragen
ungültig werden: getrennt, Konto deaktiviert, Zugriff workspace-weit
abgeschaltet. Behandle `401` und `403` nicht als Absturz, sondern als
Aufforderung, die Kopplung neu anzubieten – mit einer Meldung, die erklärt, was
passiert ist.

**Unterscheide `403` von `401`.** `401` heißt „der Token gilt nicht (mehr)" –
neu koppeln. `403` heißt meist „der externe Zugriff ist abgeschaltet" – dann
hilft kein neuer Token, sondern nur der Administrator. Sag das dem Benutzer, statt ihn
in eine Kopplungsschleife zu schicken, die nicht enden kann.

**`404` heißt nicht immer „gibt es nicht".** Wo der Zugriff fehlt, antwortet
Klappe mit `404` statt `403` – ein `403` würde verraten, dass es die ID gibt.
Für dein Plugin heißt das: „nicht gefunden" kann auch „nicht für dieses Konto"
bedeuten.

**Respektiere die Bremsen.** `429` kommt mit `Retry-After` in Sekunden; an
jeder Antwort stehen `X-RateLimit-Limit` und `X-RateLimit-Remaining`. Warte die
genannte Zeit ab, statt es sofort noch einmal zu versuchen.

**Ein Token je Gerät und Zweck.** Nicht denselben Token über fünf Rechner
verteilen – dann lässt sich einer davon nicht mehr einzeln trennen, und genau
das ist der Sinn der Sache.

**Der Token gehört nicht ins Protokoll.** Auch nicht gekürzt, auch nicht bei
Fehlern. Wenn du Anfragen mitschreibst, maskiere den `Authorization`-Header.

**Wenn deine Anwendung mehreren Leuten gehört**, dann koppelt jeder sein
eigenes Konto. Ein Token, den sich ein Team teilt, macht aus fünf Menschen
einen – an jedem Kommentar stünde derselbe Name, und alle sähen alles, was der
Kontoinhaber sieht.
