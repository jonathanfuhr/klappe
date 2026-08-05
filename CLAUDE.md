# Hinweise für die Arbeit an Klappe

Kurze Sammlung dessen, was sich beim Bauen als richtig herausgestellt hat.
Ausführlich steht die Begründung in [docs/architektur.md](docs/architektur.md);
hier stehen nur die Regeln.

## Versionsnummern

**Jede Änderung bekommt eine neue Versionsnummer** – ungefragt, als Teil des
Commits.

```bash
npm run version:bump           # 1.5.1 -> 1.5.2
npm run version:bump -- 1.6.0  # ausdrücklich
```

Die Nummer folgt der Branch-Nummer: Auf `version/1.5.1` steht `1.5.1`, jeder
weitere inhaltliche Commit erhöht die letzte Stelle. Gepflegt wird sie in allen
vier `package.json` gleichzeitig – das Skript sorgt dafür und bricht ab, wenn
sie auseinandergelaufen sind.

Sichtbar ist sie in der Oberfläche unter **Über diese Software**, zusammen mit
dem Commit-Kürzel und dem Bauzeitpunkt, und klein am Fuß der Einstellungen.

Der Grund: Klappe läuft auf mehreren Servern, und einem laufenden System war
nicht anzusehen, welcher Stand dort arbeitet. Beim Mac-Aufbau mit seinen zwei
Hälften – Container *und* nativer Worker – war genau das die häufigste
Fehlerursache; einmal lief der Worker vier Tage mit altem Build weiter, ohne
dass es jemandem auffiel.

## Commits und Zweige

Ein Zweig je Version: `version/1.5.1`. Ein Commit je abgeschlossenem Vorhaben –
nicht je Datei und nicht je Arbeitstag.

Commit-Nachrichten sind **deutsch** und erklären das **Warum**. Die erste Zeile
sagt, was sich für den Benutzer ändert („Die Zeichnung lag neben dem Bild, wenn
das Format abwich"), nicht welche Datei angefasst wurde. Darunter steht, was der
Grund war und welche Möglichkeit verworfen wurde. Wer den Commit in einem Jahr
liest, soll die Entscheidung verstehen, ohne den Code danebenzulegen.

## Beispiele und Testdaten

In Platzhaltern, Testdaten, Kommentaren und Dokumentation stehen **keine echten
Firmen-, Kunden- oder Personennamen** – auch nicht die des Betreibers. Statt
dessen `Beispiel GmbH`, `beispiel.de`, `Anna Beispiel`.

Der Grund ist nicht Förmlichkeit: Solche Namen wandern über Kopiervorlagen in
fremde Installationen und stehen dann in der Oberfläche von jemandem, der mit
ihnen nichts zu tun hat.

Ausgenommen ist die Autorenangabe unter „Über diese Software" – die gehört
dorthin.

## Ausrollen passiert auf Ansage

Code wird gebaut, geprüft, committet und gepusht. **Ausgerollt wird nur, wenn
ausdrücklich darum gebeten wurde** – ein Push ist keine Freigabe. Auf den
Servern laufen echte Projekte mit echten Kundenfreigaben.

Nach einem Ausrollen gehört ungefragt eine kurze Meldung dazu: ob gepullt wurde
(mit Commit-Kürzel) und ob die Container und der Worker tatsächlich auf dem
neuen Stand laufen. Beides zu prüfen ist der Punkt – dass die Container liefen
und der Worker nicht, ist schon vorgekommen.

## Größere Vorhaben zuerst planen

Was mehr ist als ein Fix, entsteht zuerst als **Notion-Seite**: Machbarkeit,
Vorschlag, offene Entscheidungen als Häkchen. Erst wenn die Entscheidungen
getroffen sind, wird gebaut – und die Seite danach auf den Stand gebracht, was
tatsächlich umgesetzt wurde und was bewusst anders.

So entstand die awork-Anbindung; die Seite hängt unter der Klappe-Hauptseite im
Notion des Betreibers.

## Sprache

Oberfläche, Kommentare, Commit-Nachrichten und Dokumentation sind **deutsch**.
Englisch bleibt, wo es hingehört: DTO-Felder, API-Routen, Typnamen. Innerhalb
von Funktionen sind deutsche Bezeichner die Regel (`bestehend`, `eintrag`,
`gefiltert`).

Die Oberfläche ist zweisprachig (de/en). Neue Texte gehören in **beide**
Wörterbücher unter `apps/web/src/i18n/`; ein Test hält Schlüssel, Platzhalter
und Pluralformen synchron.

## Kommentare

Kommentare erklären das **Warum**, nicht das Was. Besonders wertvoll sind die,
die festhalten, was schon einmal schiefging – davon steht viel im Code, und es
hat sich bewährt.

## Prüfen

```bash
npm run typecheck   # alle drei Workspaces
npm test            # Vitest über das ganze Monorepo
npm run build       # Produktionsbuild, findet Fehler, die der Typecheck nicht sieht
```

Getestet wird die reine Logik – Timecode-Mathematik, Zuordnungsregeln,
Textbausteine. Alles, was eine Datenbank oder einen Browser bräuchte, wird
nicht per Test abgesichert, sondern durch Nachsehen im laufenden System.

`shared` muss vor einem Typecheck gebaut sein (`npm run build -w
@klappe/shared`), sonst sieht der Rest die neuen Typen nicht.

## Datenbank

Schemaänderungen entstehen in `apps/api/src/db/schema.ts`, die Migration
danach mit `npm run db:generate -w @klappe/api`. Die erzeugte Datei bekommt
einen sprechenden deutschen Namen (`0048_awork_geloeschte_projekte.sql`), und
der Name wird im Journal `meta/_journal.json` mitgezogen.

Migrationen laufen beim Start des `api`-Containers automatisch mit.

## Ausrollen

Auf dem Mac-Server macht das Skript beides – Erstinstallation und Update:

```bash
./deploy/mac/klappe-deploy.sh
```

Der Schritt, der am ehesten vergessen wird und am längsten unbemerkt bleibt,
ist `npm ci`: Kommt eine neue Abhängigkeit dazu und fehlt sie, scheitert der
Build, das alte `dist/` bleibt liegen, und der native Worker läuft damit
weiter. Das Skript nimmt einem das ab.
