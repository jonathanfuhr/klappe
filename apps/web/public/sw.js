/*
 * Der Service Worker (Phase 29).
 *
 * Das hier ist kein Baustein von Klappe, sondern eine Datei, die der Browser
 * des Betrachters herunterlädt und in einem eigenen Faden ausführt – auf dem
 * Mac oder dem Telefon, nicht auf dem Server. Mit dem Klappe-Worker, der
 * Videos umrechnet, hat er nichts zu tun ausser dem Namen.
 *
 * Er läuft weiter, wenn kein Fenster offen ist. Genau deshalb funktioniert
 * Push überhaupt: Ohne ihn gäbe es niemanden, der eine eintreffende Meldung
 * anzeigen könnte.
 *
 * Bewusst schlicht gehalten. Er speichert nichts zwischen und fängt keine
 * Anfragen ab – ein Cache, der alte Fassungen der Oberfläche ausliefert,
 * wäre ein eigenes Fass. Hier geht es allein um Benachrichtigungen.
 *
 * Reines JavaScript im `public`-Verzeichnis, nicht durch den Baukasten
 * gereicht: Ein Service Worker muss unter einer festen Adresse in der Wurzel
 * liegen, damit sein Geltungsbereich die ganze Seite umfasst.
 */

/* eslint-env serviceworker */

/**
 * Sofort übernehmen statt auf das Schliessen aller Tabs zu warten. Eine neue
 * Fassung soll nicht erst beim übernächsten Besuch greifen – es gibt hier
 * keinen Zustand, den ein Wechsel mitten im Betrieb durcheinanderbrächte.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  /*
   * Ohne Nutzlast trotzdem etwas zeigen. Manche Push-Dienste stellen unter
   * Last eine leere Sendung zu, und die meisten Browser zeigen ohnehin von
   * sich aus eine allgemeine Meldung, wenn ein `push` ohne Anzeige endet –
   * dann lieber unsere eigenen Worte als deren „Diese Website wurde im
   * Hintergrund aktualisiert".
   */
  let daten = {};
  try {
    daten = event.data ? event.data.json() : {};
  } catch {
    daten = {};
  }

  const titel = daten.title || 'Klappe';
  const optionen = {
    body: daten.body || '',
    /*
     * Die Klammer, unter der zusammengefasst wird. Gleicher `tag` heisst:
     * Die vorhandene Kachel wird fortgeschrieben statt eine zweite gestapelt.
     * `renotify` bleibt aus – es soll einmal brummen und danach still
     * hochzählen, nicht bei jedem Kommentar erneut.
     */
    tag: daten.tag || 'klappe',
    renotify: false,
    icon: '/icon.svg',
    badge: '/icon.svg',
    /* Womit der Klick später etwas anfangen kann. */
    data: { url: daten.url || '/projekte' },
  };

  event.waitUntil(self.registration.showNotification(titel, optionen));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const ziel = (event.notification.data && event.notification.data.url) || '/projekte';

  /*
   * Ein offenes Fenster wiederverwenden statt ein zweites zu öffnen. Wer
   * Klappe schon vor sich hat, will dorthin springen und nicht denselben
   * Bestand zweimal geöffnet haben.
   */
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenster) => {
      for (const eines of fenster) {
        // Nur Fenster dieser Herkunft – `matchAll` liefert grundsätzlich
        // keine fremden, aber die Prüfung kostet nichts.
        if (new URL(eines.url).origin !== self.location.origin) continue;
        if ('focus' in eines) {
          return eines.navigate ? eines.navigate(ziel).then((f) => f && f.focus()) : eines.focus();
        }
      }
      return self.clients.openWindow(ziel);
    }),
  );
});

/*
 * Der Push-Dienst kann ein Abo von sich aus für ungültig erklären – bei
 * entzogener Erlaubnis oder nach längerer Stille. Der Browser meldet das
 * hier. Wir räumen es serverseitig weg, sonst bliebe eine Zeile stehen, die
 * bei jeder Meldung erneut scheitert.
 *
 * Ein stilles Neuanmelden wäre falsch: Wer die Erlaubnis entzogen hat, hat
 * das so gemeint.
 */
self.addEventListener('pushsubscriptionchange', (event) => {
  const alt = event.oldSubscription && event.oldSubscription.endpoint;
  if (!alt) return;
  event.waitUntil(
    fetch('/v1/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ endpoint: alt }),
    }).catch(() => undefined),
  );
});
