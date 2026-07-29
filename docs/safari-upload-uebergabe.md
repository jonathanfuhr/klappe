# Übergabe: Safari lädt nicht hoch

Für einen lokalen Durchgang **auf einem Rechner mit Safari**. Die bisherige
Sitzung lief in einer Containerumgebung ohne WebKit – Safari konnte dort nicht
nachgestellt werden, und genau daran ist die Fehlersuche bisher gescheitert.

- Repository: `klappe`, Branch `claude/klappe-projekt-phase-0-4-h9i1lp`
- Stand bei Übergabe: `431e306`
- Betrieb beim Melder: Synology-NAS, `docker compose`, Zugriff über
  `http://<NAS>:3000` (kein HTTPS, kein Reverse Proxy davor)

## Symptom

**Der Upload einer Videodatei schlägt in Safari fehl. In Chrome läuft dieselbe
Datei auf demselben Server vollständig durch.**

Verlauf der Beobachtungen (dieselbe Datei, ~92 MB, 1080p):

| Stand | Verhalten in Safari |
| --- | --- |
| Blöcke per `fetch` | Balken bleibt bei **48 MB** stehen, kein Fehler, Zustand „Lädt" |
| Blöcke per XHR + Fortschritts-Wachhund | Balken bleibt bei **128 KB** stehen |
| aktuell (`431e306`), Wachhund entfernt | **weiterhin fehlerhaft**, Ausprägung unbekannt |

Wichtig für die Deutung: Seit dem Wechsel auf XHR zeigt der Balken den
Fortschritt **innerhalb** eines Blocks. Eine stehende Zahl bedeutet also nicht
mehr „so viele Blöcke sind durch", sondern „bis hierhin kam die aktuelle
Anfrage". Die 48 MB von früher waren 6 vollständige 8-MiB-Blöcke plus ein
hängender siebter; die 128 KB waren ein Hänger im *ersten* Block.

## Was bereits ausgeschlossen ist – und womit

Bitte nicht erneut prüfen, außer die Messung wird angezweifelt:

1. **Kein fehlendes `100 Continue`.** Vermutet wurde, dass Safari nach den
   Kopfzeilen auf die Zwischenantwort wartet und die Next-Weiterleitung sie
   verschluckt. Gemessen mit `curl -H 'Expect: 100-continue'` gegen beide
   Wege – direkt an die API (Port 3001) *und* über die Next-Weiterleitung
   (Port 3000): beide antworten `HTTP/1.1 100 Continue`, danach `204`.
2. **Kein serverseitiger Schreibfehler.** Nachgestellt mit einem 40 MB großen
   Dateisystem als Ablage: Der Upload bricht dann reproduzierbar mit
   `ENOSPC` ab, sichtbar in der Oberfläche und im Log. Beim Melder erscheint
   diese Meldung nicht.
3. **Keine Ratenbremse.** Die Bremsen aus Phase 13 hängen an Anmeldung,
   Passwortwechsel, Gastcode, Abmeldelink und M365-Start – nicht am Upload.
4. **Die Next-Weiterleitung an sich ist nicht das Problem.** 92 MB laufen in
   Chromium über denselben Weg (`web:3000` → `api:3001`) vollständig durch,
   im Skript wie in der echten Oberfläche.
5. **Das Sitzungs-Cookie ist nicht die Ursache.** Das war ein *getrennter*
   Fehler (`Secure` über `http://`), behoben in `5f2fbe6`. Die Anmeldung
   funktioniert.

## Was der Code heute tut

Alles Relevante steht in **`apps/web/src/lib/upload.ts`**:

- Blöcke gehen über **`XMLHttpRequest`**, nicht `fetch` (WebKit-Fehler bei
  `fetch` mit Datei-Body – Anfrage ohne Antwort und ohne Fehler; aus
  demselben Grund setzen `tus-js-client` und Uppy hier auf XHR).
- Blockgröße: **4 MiB** (`DEFAULT_CHUNK_SIZE`), war vorher 8 MiB.
- Zeitgrenze pro Block: **`xhr.timeout`**, berechnet als
  `60_000 + Bytes / 20 kB/s` – für 4 MiB gut vier Minuten.
- **Es gibt keinen Fortschritts-Wachhund mehr.** Der frühere brach ab, wenn
  60 Sekunden kein `upload.onprogress` kam; in WebKit versiegen diese
  Ereignisse mitten in gesunden Übertragungen, wodurch er funktionierende
  Uploads abgeräumt hat. `upload.onprogress` dient jetzt **nur** der Anzeige.
- **5 Wiederholungen** mit wachsender Pause (1, 2, 4, 8, 16 s). Nach jedem
  Fehlversuch fragt der Client per `HEAD` den Stand des Servers ab und setzt
  dort an. Ein endgültiger Fehler braucht also **gut 30 Sekunden**, bis er in
  der Oberfläche steht – vorher nicht aufgeben.

Serverseite (`apps/api/src/uploads/`):

- `POST /v1/uploads` – Sitzung **ohne Ziel**; `POST /v1/videos/:id/uploads` –
  mit Ziel (Altweg).
- `HEAD /v1/uploads/:id` – Stand. `PATCH /v1/uploads/:id` – Block anhängen.
- `PATCH /v1/uploads/:id/ziel` – Zuordnung nachreichen; legt bei
  vollständiger Datei die Fassung an.
- `DELETE /v1/uploads/:id` – abbrechen.
- Ein abgerissener Client wird als **Warnung mit Byteposition** protokolliert
  (`Verbindung bei N von M Byte abgerissen (ECONNRESET)`). Alles andere –
  volle Platte, fehlende Rechte – als `ERROR` mit Fehlercode.

## Zu prüfen, in dieser Reihenfolge

### 1. Zuerst: Wo genau bleibt es stehen, und was sagen beide Seiten?

Mit **Safari → Entwickler → Web-Inspector**, Reiter *Netzwerk*, und parallel
`docker compose logs -f api` auf der NAS.

Festhalten:

- Erscheint die `PATCH`-Anfrage im Netzwerk-Reiter überhaupt?
- Welchen Status hat sie – bleibt sie „ausstehend", oder kommt ein Code?
- Die Zeitaufschlüsselung: hängt sie in *Stalled*, *Request*, oder *Waiting*?
- Bleibt es bei einer **festen** Byte-Zahl (gleiche Stelle bei jedem
  Versuch) oder bei wechselnden? Das trennt „harte Grenze im Weg" von
  „Verbindung wackelt".
- Steht im API-Log zeitgleich eine `ECONNRESET`-Warnung mit Byteposition?
  **Ja** heißt: Die Bytes kamen bis dorthin an, Safari hat die Verbindung
  fallen lassen. **Nein** heißt: Die Anfrage ist nie beim Server angekommen
  oder hängt vor ihm fest.
- Nach 30+ Sekunden: Erscheint eine Fehlermeldung im Upload-Fenster? Wenn ja,
  **wortwörtlich** notieren – sie enthält Grund, Byteposition und
  Versuchszahl.

### 2. Safari von der Anwendung trennen

Der wichtigste Schnitt. Die Testseite liegt schon im Repository:

**`apps/web/public/safari-upload-test.html`**, erreichbar unter
`http://<NAS>:3000/safari-upload-test.html` – gleicher Ursprung wie die
Anwendung, das Sitzungs-Cookie gilt also. **Vorher anmelden**, sonst leitet
die Weiche auf `/login` um.

Sie macht *nur* XHR-`PATCH` mit Blobs – kein React, kein Zustandshalter, keine
Warteschlange – und protokolliert je Block Dauer, Statuscode und die **Zahl
der Fortschrittsereignisse**. Vorher liest sie testweise den ersten Block aus
der Datei, damit ein hängender Datei-Zugriff sofort auffällt.

Sie ist in Chromium gegen dieselbe Instanz geprüft: 92 MB, 23 Blöcke, alle
`204`, 8,8 Sekunden. Wenn sie in Safari scheitert, liegt es also nicht an ihr.

Beobachtenswert: In Chromium meldet ein 4-MiB-Block über schnelle Leitung nur
**ein einziges** Fortschrittsereignis. Wer in Safari null oder eins sieht, hat
damit noch keinen Befund – die Zahl ist nur im Vergleich zur Blockdauer
aussagekräftig.

Damit lässt sich beantworten:

- Scheitert schon ein einzelner XHR-`PATCH` mit 4 MiB Blob? → Der Fehler
  liegt zwischen Safari und Server, nicht in unserem Code.
- Läuft der Einzelversuch durch? → Der Fehler steckt in unserer Schleife,
  im Zustandshalter oder in der Blockzerlegung.

Zusätzlich in der Safari-Konsole prüfen, ob das Lesen der Datei selbst
klemmt:

```js
const f = document.querySelector('input[type=file]').files[0];
console.time('slice'); await f.slice(0, 4 * 1024 * 1024).arrayBuffer(); console.timeEnd('slice');
```

Hängt das schon, ist es ein Datei-Lesefehler in Safari (kommt bei Dateien auf
Netzlaufwerken und externen Volumes vor) und hat mit dem Server nichts zu tun.

### 3. Blockgröße gegenprüfen

`DEFAULT_CHUNK_SIZE` in `apps/web/src/lib/upload.ts` testweise auf **256 KiB**
setzen, neu bauen, erneut versuchen.

- Läuft es damit durch → die Anfrage*größe* oder ‑*dauer* ist der Auslöser.
  Dann ist die richtige Lösung eine dauerhaft kleinere Blockgröße (ggf. nur
  für WebKit) und **nicht** ein weiterer Wiederholungsmechanismus.
- Bleibt es stehen → die Größe ist unschuldig, weiter mit Punkt 4.

### 4. Die Weiterleitung ausklammern

Bisher läuft alles über Next (`web:3000` → `api:3001`). Zum Ausschließen die
API direkt veröffentlichen und den Browser darauf zeigen lassen:

- in `docker-compose.yml` beim Dienst `api` `ports: ['3001:3001']` ergänzen,
- beim Bauen des Web-Images `NEXT_PUBLIC_API_BASE=http://<NAS>:3001` setzen
  (die Adresse wird zur Bauzeit fest eingebacken),
- `SESSION_COOKIE_SECURE` bleibt aus, und die API muss dieselbe Herkunft
  bekommen oder CORS erlauben – ohne das schlägt die Anmeldung fehl, was
  **nicht** mit dem Uploadfehler verwechselt werden darf.

Läuft es direkt gegen die API durch, liegt es an der Next-Weiterleitung.

### 5. Umfeld festhalten

- Safari-Version und macOS-Version; iOS oder macOS?
- Privates Fenster? Inhaltsblocker aktiv? „Cross-Site-Tracking verhindern"?
- Ist die Datei lokal oder auf einem Netzlaufwerk/externen Volume?
- Tritt es auch bei einer **kleinen** Datei auf (z. B. 5 MB)? Damit steht
  fest, ob es überhaupt größenabhängig ist.

## Fallstricke

- **Nicht zu früh aufgeben.** Fünf Wiederholungen mit wachsender Pause
  brauchen gut 30 Sekunden bis zur Fehlermeldung.
- **Die Zahl im Balken ist kein Byte-Zähler des Servers.** Sie kommt aus
  `xhr.upload.onprogress` und sagt nur, was Safari abgegeben hat.
- **Keinen neuen Wachhund auf Fortschrittsereignisse bauen.** Genau das war
  der vorige Fehler.
- **Nicht mit dem Cookie-Problem verwechseln.** Wenn die Anmeldung selbst
  scheitert, ist es Punkt 5 der ausgeschlossenen Liste – nicht dieser Fehler.

## Wann es als behoben gilt

Eine Datei von ~90 MB läuft in Safari vollständig durch, die Fassung
erscheint am Video und geht in die Verarbeitung – und in Chrome funktioniert
weiterhin dasselbe. Beides prüfen: Die letzte Änderung hat Safari
verschlechtert, während Chrome unauffällig blieb.
