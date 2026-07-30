# Safari lädt nicht hoch – gefunden und behoben

Aufgeklärt am 29.07.2026 auf dem Betriebsrechner (Unraid, `docker compose`,
Zugriff über Tailscale auf `http://fuhrserver…:3000`). Diese Datei war die
Übergabe für die Suche; sie steht jetzt hier, damit der Fehler beim nächsten
Mal in Minuten statt in Tagen erkannt wird.

## Das Symptom

Der Upload einer Videodatei blieb in Safari bei **128 KB** stehen: kein Fehler,
keine Meldung, Zustand „Lädt". In Chrome lief dieselbe Datei über denselben
Server vollständig durch.

## Die Ursache

**Nexts eigene Weiterleitung setzt `Connection: close` auf jede Antwort unter
`/v1/*`.** Sie benutzt intern `http-proxy` ohne Agent, und der erzwingt diesen
Header; er landet unverändert beim Browser.

Damit ist die Verbindung nach **jedem** Block tot. Der Client bekommt `204` und
schickt im selben Atemzug den nächsten Block – der fällt in die gerade
sterbende Verbindung. Das Schreiben gelingt noch (die Bytes landen im
Sendepuffer des Rechners, **daher die 128 KB**), eine Antwort kommt nie, ein
Fehler auch nicht.

Gemessen, alles am laufenden Betrieb:

| Weg | Antwortkopf | Zweiter `PATCH` auf derselben Verbindung |
| --- | --- | --- |
| direkt an `api:3001` | `Connection: keep-alive` | läuft |
| über Nexts `/v1`-Weiterleitung | **`connection: close`** | `BrokenPipeError` |
| normale Next-Seite (`/login`) | `Connection: keep-alive` | läuft |

**Warum Chrome nichts merkte:** Es wiederholt eine Anfrage, die auf einer
wiederverwendeten Verbindung vor dem ersten Antwortbyte abriss, von selbst –
auch bei `PATCH`. WebKit tut das nicht, und es darf es auch nicht: Es kann
nicht wissen, ob der Server den Block schon geschrieben hat. Also hing der XHR,
bis nach 4½ Minuten `xhr.timeout` zuschlug. Danach holte der Client per `HEAD`
den Stand und wiederholte – **dieser eine Block kam durch**, und das Spiel
begann von vorn. Ein Upload kroch so mit einem Block pro Zeitgrenze voran.

Ein zweiter, kleinerer Fund derselben Art: Node schließt ruhende
Keep-Alive-Verbindungen nach **5 Sekunden**. Gemessen: FIN nach 6,00 s, und eine
danach wiederverwendete Verbindung verschluckte die Anfrage genauso spurlos.
Das betraf alles außer `/v1/*` und erklärt den allerersten Hänger.

Und ein dritter, der erst nach den beiden Server-Korrekturen sichtbar wurde,
weil er dasselbe Symptom trägt: **Safari stellt dem XHR die Antwort nicht zu,
wenn der Anfrage-Body dateigestützt ist – oder ein `ArrayBuffer`.** Der Block
geht vollständig raus, `upload.onload` feuert, Proxy und API protokollieren
`204` mit Feld für Feld identischen Einträgen – aber der Client sieht nichts
und hängt bis `xhr.timeout`. Der direkte Vergleich, gleiche Minute, gleicher
Server, drei Läufe der Testseite:

| Body des Blocks | Ergebnis in Safari 26.5.2 |
| --- | --- |
| Blob im Arbeitsspeicher, direkt gesendet | läuft |
| derselbe Inhalt als `ArrayBuffer` | hängt nach Block 1 |
| gelesen und wieder als Blob verpackt | läuft |

Die Falle dabei: Der naheliegende Ausweg aus dem Datei-Fehler – den Block per
`arrayBuffer()` lesen und senden – tauscht nur einen kaputten Pfad gegen den
anderen. Funktioniert hat allein `new Blob([await slice.arrayBuffer()])`:
Das Lesen löst die Bindung an die Datei, der Blob nimmt den heilen Sendepfad.

## Was geändert wurde

**Ein Reverse Proxy vor dem Stapel.** `caddy` nimmt Port 3000 entgegen und
verteilt `/v1/*` direkt an `api:3001`, alles andere an `web:3000`. Next ist
damit aus dem Uploadweg raus. Die Herkunft bleibt dieselbe – das Sitzungs-Cookie
greift weiter, CORS wird nicht gebraucht. **Der Proxy ist nicht optional**; die
Begründung steht in `docker/klappe-routen.caddy`. Die HTTPS-Variante benutzt
dieselbe Wegeverteilung.

**`KEEP_ALIVE_TIMEOUT=59000` am Web-Dienst und `keepAliveTimeout` in der API.**
Gegen den zweiten Fund. 59 s, weil Nodes `headersTimeout` bei 60 s steht. Die
Regel dahinter: Ein Proxy darf eine Verbindung nie länger für gültig halten, als
der Server dahinter sie offen hält – sonst wandert der Fehler nur eine Etage
tiefer.

**Ein `HEAD` vor dem ersten Block** (`aufwaermen` in
`apps/web/src/lib/upload.ts`). Idempotent, also wiederholt WebKit es notfalls
selbst und räumt dabei tote Verbindungen aus dem Pool, bevor der teure Block
sie erwischt. Gürtel und Hosenträger – die Ursache liegt auf der Serverseite.

**Jeder Block wird gelesen und als Blob gesendet** (`leseBlock` in
`apps/web/src/lib/upload.ts`) – gegen den dritten Fund. Weder `file.slice()`
direkt noch ein `ArrayBuffer` dürfen als Body auf die Reise: beides hängt in
Safari. Bei der Testseite steht die Sendeart zum Gegenprüfen als Schalter drin.

**`UPLOAD_TRACE=1`** (`apps/api/src/uploads/upload-trace.ts`, standardmäßig
aus). Schreibt pro Block: Eintreffen, alle 10 Sekunden die Byteposition im
Stillstand, Abschluss mit der Angabe, ob der Body vollständig war. Genau das
fehlte am Anfang: Die API schwieg bei einem gelungenen Block wie bei einem, der
nie ankam, und „nichts im Log" ließ sich deshalb nicht deuten.

**Die Testseite** unter `/safari-upload-test.html` meldet jetzt alle zwei
Sekunden, wie viele Bytes abgegeben wurden und wie lange die letzte Regung her
ist, unterscheidet Stillstand vor und nach dem vollständigen Abgeben des Bodys,
kann sich die Testdatei selbst erzeugen und startet auf Wunsch von allein
(`?auto=1&mb=92`). Ohne sie dauert es 27 Minuten, bis überhaupt eine
Fehlermeldung erscheint.

**`MEDIA_DIR`.** Die Nutzdaten lagen in einem benannten Docker-Volume und damit
in Unraids `docker.img` – 30 GB, geteilt mit allen anderen Containern. Ein
einziges 40-GB-Kameraband hätte den Host lahmgelegt. Liegt jetzt auf dem Array.

## Wenn so etwas wiederkommt

Die Frage ist fast nie „warum schickt der Browser nicht", sondern **„wer holt
die Daten nicht ab"**. Drei Messungen, in dieser Reihenfolge:

1. **Steht überhaupt eine Verbindung?** Auf dem Host, während es hängt:
   `nsenter -t $(docker inspect -f '{{.State.Pid}}' klappe-caddy-1) -n ss -tn state established`.
   Keine Verbindung heißt: Die Anfrage verlässt den Rechner nicht – sie ist in
   einer toten Verbindung verschwunden. Eine Verbindung mit vollem `Recv-Q`
   heißt: Sie kommt an, wird aber nicht gelesen.
2. **Was steht in den Antwortköpfen?** `curl -D - -X PATCH …` gegen beide Wege.
   Ein `Connection: close` unter `/v1/*` ist der Rückfall in genau diesen
   Fehler.
3. **Sieht die API den Block?** `UPLOAD_TRACE=1` und `docker compose logs -f api`.

## Fallstricke

- **Die Zahl im Balken ist kein Byte-Zähler des Servers.** Sie kommt aus
  `xhr.upload.onprogress` und sagt nur, was der Browser abgegeben hat – und der
  gibt in 128-KiB-Schritten ab. „Bleibt bei 128 KB stehen" heißt: **ein
  einziges Fortschrittsereignis, danach nichts**, also niemand holt ab.
- **Keinen Wachhund auf Fortschrittsereignisse bauen.** Ein früherer Versuch
  brach ab, wenn 60 s kein `upload.onprogress` kam – und damit genau die
  Wiederholungen, die noch auf das Weiterlesen der Gegenstelle warteten.
- **Nicht zu früh aufgeben.** Ein hängender Block braucht `xhr.timeout` von
  265 s, sechs Versuche plus Pausen sind **27 Minuten** bis zur Meldung. Wer nur
  wissen will, *ob* es hängt, nimmt die Standmeldung der Testseite.
- **Nicht mit dem Cookie-Problem verwechseln.** Scheitert schon die Anmeldung,
  ist es der getrennte Fehler aus `5f2fbe6` (`Secure` über `http://`).

## Was unterwegs ausgeschlossen wurde

Alles gemessen, nicht vermutet – bitte nicht erneut prüfen:

1. **Der Upload-Client in Safari.** 92 MB in 4-MiB-XHR-Blöcken laufen in Safari
   26.5.2 gegen eine saubere Gegenstelle fehlerfrei durch – dateigestützt wie
   aus dem Speicher, gedrosselt wie ungedrosselt.
2. **Die Anfrage-Kopfzeilen.** Safari und Chrome schicken dasselbe: kein
   `Expect`, kein `Transfer-Encoding: chunked`, beide mit `Content-Length`.
3. **Die Blockgröße.** 4 MiB, 8 MiB und 256 KiB verhalten sich gleich.
4. **Die Platte.** 329 MB/s mit `fsync` ins Medienverzeichnis.
5. **Ein serverseitiger Schreibfehler.** Mit einem 40-MB-Dateisystem als Ablage
   bricht der Upload reproduzierbar mit `ENOSPC` ab, sichtbar in Oberfläche und
   Log. Diese Meldung kam nie.
6. **Die Ratenbremsen aus Phase 13.** Sie hängen an Anmeldung, Passwortwechsel,
   Gastcode, Abmeldelink und M365-Start – nicht am Upload.
7. **Die Next-Middleware.** Ihr Matcher schließt `v1/` aus, Upload-Blöcke gehen
   nicht durch sie hindurch.
8. **`100 Continue`.** Beide Wege beantworten `Expect: 100-continue` sauber –
   und Safari schickt den Header ohnehin nicht.
