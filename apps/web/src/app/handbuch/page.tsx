import type { Metadata } from 'next';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Handbuch · Klappe',
};

/**
 * Handbuch für Benutzer und Gäste.
 *
 * Bewusst für alle Angemeldeten offen, auch für Gäste – anders als die
 * Verwaltungsseiten unter „Einstellungen". Der Inhalt liegt zusätzlich als
 * Markdown unter `docs/handbuch.md` in der Repo; beide sollen bei
 * Änderungen zusammen gepflegt werden.
 */
export default function HandbuchPage() {
  return (
    <AppShell>
      <div className="page">
        <div className="page__header">
          <div>
            <h1 className="page__title">Handbuch</h1>
            <p className="page__subtitle">
              Für alle, die mit Klappe arbeiten – Team wie eingeladene Gäste.
            </p>
          </div>
        </div>

        <div className="manual">
          <nav className="card manual__toc" aria-label="Inhalt">
            <a href="#anmelden">Anmelden</a>
            <a href="#oberflaeche">Oberfläche</a>
            <a href="#projekte">Projekte, Videos, Fassungen</a>
            <a href="#hochladen">Hochladen</a>
            <a href="#player">Der Player</a>
            <a href="#kommentieren">Kommentieren &amp; Zeichnen</a>
            <a href="#freigeben">Freigeben</a>
            <a href="#gast">Als Gast bei Klappe</a>
            <a href="#ablage">Kunden-Ablage</a>
            <a href="#downloads">Herunterladen</a>
            <a href="#benachrichtigungen">Benachrichtigungen</a>
            <a href="#konto">Mein Konto</a>
            <a href="#einstellungen">Einstellungen (Team)</a>
            <a href="#faq">Häufige Fragen</a>
          </nav>

          <section id="anmelden" className="card manual__section">
            <h2>Anmelden</h2>
            <p>
              <strong>Team-Mitglieder</strong> melden sich mit E-Mail-Adresse und Passwort an,
              oder – falls eingerichtet – über den Microsoft-365-Knopf auf der Anmeldeseite.
            </p>
            <p>
              <strong>Gäste</strong> brauchen kein Konto und kein Passwort. Es gibt zwei Wege
              herein:
            </p>
            <ol>
              <li>
                <strong>Über einen Freigabe-Link.</strong> Ein Klick führt zu einer Seite, die
                zunächst nach der E-Mail-Adresse fragt. Danach kommt eine Mail mit einem
                sechsstelligen Code – eintragen, fertig. Nach dem Namen wird nur beim
                allerersten Besuch gefragt, danach nie wieder. Wer noch angemeldet ist, geht
                beim nächsten Klick auf denselben Link ohne jeden Zwischenschritt hindurch.
              </li>
              <li>
                <strong>Über den Gastzugang auf der Anmeldeseite</strong>, falls der Link einmal
                nicht zur Hand ist. Auch hier reichen E-Mail-Adresse und Code. Das legt kein
                neues Konto an – für eine Adresse ohne Freigabe verschickt Klappe keine Mail,
                die Absage steht direkt im Browser.
              </li>
            </ol>
            <p>
              Ein Anmeldecode ist einige Minuten gültig. Kommt keine Mail an, lohnt ein Blick in
              den Spam-Ordner.
            </p>
          </section>

          <section id="oberflaeche" className="card manual__section">
            <h2>Die Oberfläche im Überblick</h2>
            <p>Die Kopfzeile ist überall gleich:</p>
            <ul>
              <li><strong>Logo/Titel</strong> links führt zur Projektliste.</li>
              <li><strong>Projekte</strong> zeigt alle Projekte, auf die Zugriff besteht.</li>
              <li><strong>Handbuch</strong> und <strong>Über diese Software</strong> – diese beiden Seiten.</li>
              <li><strong>Einstellungen</strong> steht nur Team-Mitgliedern und Admins zur Verfügung.</li>
              <li>
                Rechts das Glockensymbol für die Benachrichtigungszentrale, daneben der eigene
                Name (führt zu <strong>Mein Konto</strong>) und der Abmelden-Knopf.
              </li>
            </ul>
            <p>
              Ein Projekt öffnet die Liste seiner Videos; ein Video öffnet den Player mit der
              neuesten Fassung. Von dort lässt sich jederzeit zwischen den Fassungen wechseln.
            </p>
          </section>

          <section id="projekte" className="card manual__section">
            <h2>Projekte, Videos und Fassungen</h2>
            <p>
              Die Struktur ist immer <strong>Projekt → Video → Fassung</strong>. Ein Video kann
              beliebig viele Fassungen tragen (v1, v2, v2.5, v3 …) – für jede neue Version wird
              eine neue Fassung hochgeladen, die alte bleibt erhalten und vergleichbar.
            </p>
            <p>
              In der Projektliste steht der <strong>Kunde groß über dem Projektnamen</strong>;
              je nach Einrichtung stehen auf der Kachel auch einzelne benutzerdefinierte Felder,
              etwa eine Projektnummer.
            </p>
            <p>
              Eine Fassung kann als <strong>Endfassung</strong> markiert sein. Ist sie das nicht,
              zeigt Klappe beim Ansehen einen deutlichen Hinweis, dass es sich um einen
              Zwischenstand handelt.
            </p>
            <p>
              Ein archiviertes Projekt bleibt sichtbar und abspielbar, zeigt aber je Video nur
              noch die neueste fertige Fassung, und kommentieren geht nicht mehr.
            </p>
          </section>

          <section id="hochladen" className="card manual__section">
            <h2>Hochladen</h2>
            <p>
              Das Upload-Fenster liegt unten rechts und lässt sich ein- und ausklappen. Es nimmt
              beliebig viele Dateien auf einmal an – auch ganze Ordner per Drag &amp; Drop – und
              läuft beim Seitenwechsel einfach weiter.
            </p>
            <p>
              Die Übertragung geht in kleinen Blöcken. Bricht die Verbindung mittendrin ab, geht
              es beim nächsten Versuch genau an der Stelle weiter, an der sie aufgehört hat.
            </p>
            <p>
              Aus dem Dateinamen schlägt Klappe Projekt, Video und Versionsnummer vor – jeder
              Vorschlag ist deutlich als <em>bitte prüfen</em> markiert und wird erst angelegt,
              wenn aktiv auf <strong>Speichern</strong> geklickt wird.
            </p>
            <p>
              <strong>Wer darf hochladen?</strong> Team-Mitglieder immer. Gäste nur, wenn ein
              Freigabe-Link das ausdrücklich erlaubt.
            </p>
          </section>

          <section id="player" className="card manual__section">
            <h2>Der Player</h2>
            <p>
              Der Player spielt <strong>frame-genau</strong>: Was im Player als Frame 812
              angezeigt wird, ist exakt Frame 812 im Schnittprogramm.
            </p>
            <h3>Tastenkürzel</h3>
            <div className="tablewrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Taste</th>
                    <th>Wirkung</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><span className="kbd">Leertaste</span></td>
                    <td>Abspielen / Pause</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="kbd">J</span> / <span className="kbd">K</span> /{' '}
                      <span className="kbd">L</span>
                    </td>
                    <td>Rückwärts / Stopp / Vorwärts (mehrfach drücken = schneller)</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="kbd">←</span> / <span className="kbd">→</span>
                    </td>
                    <td>Ein Bild zurück / vor</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="kbd">Umschalt</span> + <span className="kbd">←</span> /{' '}
                      <span className="kbd">→</span>
                    </td>
                    <td>Eine Sekunde zurück / vor</td>
                  </tr>
                  <tr>
                    <td>
                      <span className="kbd">Pos1</span> / <span className="kbd">Ende</span>
                    </td>
                    <td>Erstes / letztes Bild</td>
                  </tr>
                  <tr>
                    <td><span className="kbd">C</span></td>
                    <td>Kommentar am aktuellen Bild</td>
                  </tr>
                  <tr>
                    <td><span className="kbd">D</span></td>
                    <td>Zeichnen am aktuellen Bild</td>
                  </tr>
                  <tr>
                    <td><span className="kbd">M</span></td>
                    <td>Ton stumm</td>
                  </tr>
                  <tr>
                    <td><span className="kbd">F</span></td>
                    <td>Vollbild</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p style={{ marginTop: 12 }}>
              Am Telefon im Querformat passt sich das Layout an; wird es eng, weicht als Erstes
              die Frame-Nummer, der Timecode bleibt immer sichtbar.
            </p>
            <p>
              Im <strong>Vollbild</strong> lässt sich weiter kommentieren: Der Kommentar-Knopf
              (oder <span className="kbd">C</span>) fährt die Kommentarspalte von rechts ins
              Bild; das Kreuz oben schließt sie wieder.
            </p>
            <h3>Wiedergabequalität</h3>
            <p>
              Steht für ein Video die adaptive Wiedergabe bereit, erscheint in der Steuerleiste
              eine <strong>Qualitätswahl</strong>. Auf <strong>Auto</strong> wählt Klappe die
              Stufe nach der gemessenen Verbindung – die gerade gespielte Stufe steht in
              Klammern dabei. Wer eine bestimmte Stufe sehen will (etwa garantiert 1080p für
              die Abnahme), wählt sie fest; <em>Auto</em> gibt die Wahl zurück. In Safari
              übernimmt der Browser die Wahl selbst, dort gibt es den Umschalter nicht.
            </p>
          </section>

          <section id="kommentieren" className="card manual__section">
            <h2>Kommentieren und Zeichnen</h2>
            <p>
              Ein Kommentar hängt an einem <strong>einzelnen Frame</strong>, nicht an einer
              ungefähren Sekunde. Es lässt sich antworten, mit <code>@Name</code> jemand
              erwähnen (die Person bekommt Bescheid), und ein Kommentar lässt sich als{' '}
              <strong>erledigt</strong> markieren.
            </p>
            <p>
              Dazu gibt es ein <strong>Zeichenwerkzeug</strong>: direkt auf dem Standbild in
              mehreren Farben markieren, was gemeint ist – der Strich hängt am selben Frame wie
              der Kommentar.
            </p>
            <p>
              <strong>Tipp:</strong> Bild anhalten, <span className="kbd">C</span> drücken (oder{' '}
              <span className="kbd">D</span> fürs Zeichnen), Anmerkung eintippen bzw. malen,
              abschicken.
            </p>
          </section>

          <section id="freigeben" className="card manual__section">
            <h2>Freigeben</h2>
            <p>
              Ein Freigabe-Link lässt sich auf ein ganzes <strong>Projekt</strong> oder ein
              einzelnes <strong>Video</strong> ausstellen. Beim Anlegen wird festgelegt, ob über
              den Link kommentiert, heruntergeladen und hochgeladen werden darf. Diese Rechte
              lassen sich zusätzlich pro Person abweichend vom Link setzen.
            </p>
            <p>
              Neben dem Player liegt die Spalte <strong>Freigaben</strong> mit allen Personen,
              die Zugriff haben. Ein Zugang lässt sich jederzeit entziehen – das wirkt sofort und
              trifft nur die eine Person.
            </p>
            <h3>Externer Projektadmin</h3>
            <p>
              Für die Zusammenarbeit mit Agenturen kann das Team einen Gast an seiner
              Projektfreigabe zum <strong>Externen Projektadmin</strong> machen. Er darf dann in
              genau diesem Projekt Videos anlegen, eigene Fassungen hochladen und löschen,
              weiter freigeben und fremde Kommentare verwalten. Projekt und Videos umbenennen
              oder löschen bleibt dem Team vorbehalten, ebenso das Ändern bestehender
              Freigabe-Links.
            </p>
            <h3>Einbetten</h3>
            <p>
              Ein Video lässt sich in eine fremde Seite einbetten – über das{' '}
              <strong>„…"-Menü → Einbetten</strong> am Video, nicht über die Freigaben. Ein
              Freigabe-Link lädt zum Anmelden und Kommentieren ein, ein Einbett-Link zeigt nur
              den Player; deshalb sind es zwei verschiedene Links.
            </p>
            <p>
              Mit dem Einbett-Link kann sich niemand anmelden, und ausgeliefert wird
              ausschließlich die neueste <strong>Endfassung</strong> – ohne gesetzten
              Endfassungs-Haken bleibt der Player leer. Kommentare, Gästeliste und Download gibt
              es dort nicht. Zurückziehen wirkt sofort.
            </p>
          </section>

          <section id="gast" className="card manual__section">
            <h2>Als Gast bei Klappe</h2>
            <p>Als Gast ist zu sehen, wozu eingeladen wurde. Möglich ist:</p>
            <ul>
              <li>freigegebene Videos ansehen (frame-genau, mit allen Tastenkürzeln),</li>
              <li>kommentieren und zeichnen, sofern der Link das erlaubt,</li>
              <li>herunterladen, sofern der Link das erlaubt,</li>
              <li>eigenes Material hochladen, sofern der Link das erlaubt.</li>
            </ul>
            <p>
              Ein eigenes Passwort gibt es nicht – der Zugang läuft ausschließlich über
              E-Mail-Adresse und den zugeschickten Code. Wurde der Zugang zurückgezogen, führt
              auch ein alter Link nicht mehr herein.
            </p>
          </section>

          <section id="ablage" className="card manual__section">
            <h2>Kunden-Ablage</h2>
            <p>
              Jedes Projekt hat einen eigenen Bereich für Kundenmaterial – Briefings, Logos,
              eigene Schnittfassungen. Er funktioniert wie ein gewöhnlicher Ordner: Unterordner
              anlegen, Dateien hochladen, umbenennen, löschen. Ein ganzer Ordner lässt sich auch
              als ZIP-Datei herunterladen.
            </p>
          </section>

          <section id="downloads" className="card manual__section">
            <h2>Herunterladen</h2>
            <p>
              Der <strong>Herunterladen</strong>-Knopf öffnet immer ein Fenster – auch ohne
              zusätzliche Formate. Dort steht der Dateiname, unter dem die Datei gleich landet,
              und bei einer Fassung ohne Endfassungs-Haken die Warnung, dass hier ein
              Zwischenstand das Haus verlässt. Ganz oben steht immer das{' '}
              <strong>Original</strong> – die unveränderte hochgeladene Datei. Je nach
              Einrichtung stehen darunter zusätzliche fertige Formate zur Auswahl.
            </p>
            <p>Heruntergeladene Dateien tragen einen sprechenden Namen nach diesem Schema:</p>
            <pre className="codeblock">
              JJMMTT_Kunde_Projektname_Videoname_Versionsnummer_Auflösung.Dateiendung{'\n'}
              260304_Beispiel-Marketing_Sommer-Kampagne_Reel-Hochkant_v1_2160p25.mov
            </pre>
          </section>

          <section id="benachrichtigungen" className="card manual__section">
            <h2>Benachrichtigungen</h2>
            <p>
              Wer über neue Kommentare informiert werden möchte, trägt sich in der Spalte{' '}
              <strong>Benachrichtigungen</strong> ein – für ein ganzes Projekt oder ein einzelnes
              Video. Wer selbst eine neue Fassung hochlädt, wird für dieses Video automatisch
              eingetragen. Mails werden meist gebündelt verschickt, statt für jede Anmerkung
              einzeln.
            </p>
            <p>
              Unabhängig davon gibt es die <strong>Benachrichtigungszentrale</strong>: das
              Glockensymbol in der Kopfzeile. Dort steht sofort, wer was wo geschrieben hat –
              auch Gäste haben diese Zentrale.
            </p>
          </section>

          <section id="konto" className="card manual__section">
            <h2>Mein Konto</h2>
            <p>
              Unter <strong>Mein Konto</strong> (Klick auf den eigenen Namen in der Kopfzeile)
              lässt sich der eigene <strong>Name</strong> ändern – so, wie er in Kommentaren,
              Listen und Benachrichtigungen erscheint. Das gilt für Team und Gäste
              gleichermaßen.
            </p>
            <p>
              Team-Mitglieder ändern dort außerdem ihr <strong>Passwort</strong>. Gäste haben
              keines – ihr Zugang läuft über den Mail-Code.
            </p>
          </section>

          <section id="einstellungen" className="card manual__section">
            <h2>Einstellungen (Team)</h2>
            <p>Team-Mitglieder und Admins finden unter Einstellungen unter anderem:</p>
            <ul>
              <li><strong>Gäste</strong> – wer Zugang hat, und die Möglichkeit, ihn zu entziehen.</li>
              <li><strong>Benutzer</strong>, <strong>Benutzerdefinierte Felder</strong>, <strong>Projekte</strong> – dem Admin vorbehalten.</li>
              <li><strong>Erscheinungsbild</strong> – Titel, Logo und Akzentfarbe des Workspace.</li>
              <li><strong>Anmeldung</strong> – lokale Konten und/oder Microsoft 365.</li>
              <li><strong>E-Mail-Versand</strong> – SMTP-Einrichtung, Bündel-Zeitfenster, unzustellbare Mails.</li>
              <li><strong>Transcode</strong> – welche Download-Formate angeboten und wann sie erzeugt werden.</li>
              <li><strong>Speicher</strong> – wie viel Platz auf der Platte noch frei ist und wie viel davon Klappe belegt.</li>
              <li><strong>Datensicherung</strong> – ob und wie oft die Datenbank gesichert wird, und das Wiedereinspielen einer Sicherung.</li>
            </ul>
          </section>

          <section id="faq" className="card manual__section">
            <h2>Häufige Fragen</h2>
            <p>
              <strong>Ich habe keinen Code bekommen.</strong> Im Spam-Ordner nachsehen. Bleibt
              die Mail aus, ist entweder der Mailversand nicht eingerichtet oder die eigene
              Adresse hat (noch) keine Freigabe.
            </p>
            <p>
              <strong>Mein alter Link funktioniert nicht mehr.</strong> Dann wurde der Zugang
              zurückgezogen. Das Team kann eine neue Freigabe ausstellen.
            </p>
            <p>
              <strong>Warum sehe ich einen Hinweis „kein Endstand"?</strong> Die angezeigte
              Fassung ist ausdrücklich noch nicht als fertig markiert.
            </p>
            <p>
              <strong>Wo steht, wer diese Software gebaut hat und wo sie läuft?</strong> Auf der
              Seite <Link href="/ueber">Über diese Software</Link>.
            </p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
