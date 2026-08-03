/**
 * Push-Benachrichtigungen im Browser (Phase 29).
 *
 * Die eine Frage, an der hier alles hängt: `'PushManager' in window`. Auf
 * einem iPhone im gewöhnlichen Safari-Tab ist die Antwort **nein** – Apple
 * gibt Web Push dort nur an Seiten heraus, die über „Zum Home-Bildschirm"
 * abgelegt wurden. Damit blendet diese eine Prüfung die Zeile genau dort aus,
 * wo sie ohnehin nichts bewirken würde, ohne dass jemand Plattformen erraten
 * muss. Die Geräteart braucht es nur noch für die Beschriftung.
 */
import { api } from './api';

/** Kann dieser Browser hier und jetzt Push? */
export function pushMoeglich(): boolean {
  if (typeof window === 'undefined') return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * Grobe Zeigergeräte bekommen „Geräte-", alles andere „Desktop-
 * Benachrichtigungen". Bewusst nach Eingabeart und nicht nach Betriebssystem:
 * Ein iPad mit Tastatur ist für diese Frage ein Rechner, und die Wortwahl
 * soll zu dem passen, was gleich brummt.
 */
export function istHandgeraet(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

/** Der Stand der Erlaubnis, ohne sie anzufragen. */
export function erlaubnis(): NotificationPermission | null {
  if (!pushMoeglich()) return null;
  return Notification.permission;
}

/**
 * Den Service Worker anmelden. Mehrfach aufzurufen ist unschädlich – der
 * Browser gibt dieselbe Anmeldung zurück, statt eine zweite anzulegen.
 */
async function registrierung(): Promise<ServiceWorkerRegistration> {
  const vorhanden = await navigator.serviceWorker.getRegistration('/sw.js');
  if (vorhanden) return vorhanden;
  return navigator.serviceWorker.register('/sw.js');
}

/** Das Abo dieses Browsers, falls eines besteht. */
export async function bestehendesAbo(): Promise<PushSubscription | null> {
  if (!pushMoeglich()) return null;
  try {
    const anmeldung = await registrierung();
    return await anmeldung.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Einschalten.
 *
 * **Muss aus einer Klick- oder Tipp-Geste heraus aufgerufen werden.** Safari
 * verlangt das für `requestPermission()`, und ungefragt beim Laden zu fragen
 * wäre ohnehin die sicherste Art, ein „Blockieren" zu ernten, das sich
 * hinterher kaum zurücknehmen lässt.
 *
 * Gibt `false` zurück, wenn abgelehnt wurde – das ist kein Fehler, sondern
 * eine Antwort.
 */
export async function einschalten(): Promise<boolean> {
  if (!pushMoeglich()) return false;

  const antwort = await Notification.requestPermission();
  if (antwort !== 'granted') return false;

  const { publicKey } = await api.pushKey();
  if (!publicKey) return false;

  const anmeldung = await registrierung();
  /*
   * Ein bestehendes Abo weiterverwenden. Ein zweites `subscribe()` mit
   * abweichendem Schlüssel würde der Browser mit einem Fehler abweisen –
   * und nach einem Schlüsselwechsel am Server ist genau das der Fall.
   */
  const vorhanden = await anmeldung.pushManager.getSubscription();
  const abo =
    vorhanden ??
    (await anmeldung.pushManager.subscribe({
      // Ohne das lehnen Chrome und Safari ab: Ein Abo, das auch stumme
      // Sendungen erlaubt, gäbe es nur mit eigener Begründung.
      userVisibleOnly: true,
      applicationServerKey: base64UrlZuBytes(publicKey),
    }));

  const roh = abo.toJSON();
  if (!roh.keys?.p256dh || !roh.keys?.auth) return false;

  await api.pushSubscribe({
    endpoint: abo.endpoint,
    p256dh: roh.keys.p256dh,
    auth: roh.keys.auth,
    userAgent: navigator.userAgent.slice(0, 300),
  });
  return true;
}

/**
 * Ausschalten – im Browser **und** am Server.
 *
 * Beides, und in dieser Reihenfolge: Bliebe die Zeile am Server stehen,
 * liefe jede weitere Meldung gegen einen Endpunkt, den es nicht mehr gibt.
 * Die Erlaubnis selbst wird nicht zurückgenommen, das kann nur der Mensch
 * in seinen Browsereinstellungen.
 */
export async function ausschalten(): Promise<void> {
  const abo = await bestehendesAbo();
  if (!abo) return;
  const endpoint = abo.endpoint;
  try {
    await abo.unsubscribe();
  } catch {
    // Auch wenn der Browser sich querstellt: Am Server muss es weg.
  }
  await api.pushUnsubscribe(endpoint);
}

/**
 * Der VAPID-Schlüssel kommt als Base64url; `subscribe()` will Bytes.
 * `atob` kennt nur das gewöhnliche Base64, deshalb erst die beiden
 * getauschten Zeichen zurück und die fehlenden Polster auffüllen.
 */
function base64UrlZuBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const polster = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + polster).replace(/-/g, '+').replace(/_/g, '/');
  const roh = window.atob(base64);
  // Der Puffer wird ausdrücklich angelegt, statt `new Uint8Array(länge)` zu
  // nehmen: Sonst gilt der Typ als „irgendein Puffer", und `subscribe()`
  // nimmt nur einen gewöhnlichen `ArrayBuffer` an.
  const bytes = new Uint8Array(new ArrayBuffer(roh.length));
  for (let i = 0; i < roh.length; i += 1) bytes[i] = roh.charCodeAt(i);
  return bytes;
}
