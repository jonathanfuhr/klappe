import { API_BASE, api } from './api';

/**
 * Client für den resumable Upload (tus-Semantik, siehe `apps/api/src/uploads`).
 *
 * Die Datei wird in Blöcken geschickt. Reißt die Verbindung ab, fragt der
 * Client per `HEAD` den Stand beim Server ab und macht genau dort weiter –
 * bei 40-GB-Kameramaterial über WLAN ist das der Unterschied zwischen
 * „nochmal von vorn“ und „läuft weiter“.
 */
/**
 * Kleiner als die früheren 8 MiB. Eine kurze Anfrage übersteht einen
 * Aussetzer eher, und eine Wiederholung kostet weniger. Der Aufpreis sind
 * mehr Anfragen – bei 8 MB Overhead pro Stunde nicht der Rede wert.
 */
const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;
const MAX_RETRIES = 5;
/**
 * Obergrenze für einen einzelnen Block, damit ein Hänger nicht ewig dauert.
 *
 * Bewusst `xhr.timeout` statt einer eigenen Uhr auf `upload.onprogress`: In
 * WebKit hören diese Ereignisse mitten in einer *gesunden* Übertragung auf zu
 * feuern. Eine Wache, die daran hängt, bricht dann genau das ab, was gerade
 * funktioniert – in Safari blieb der Balken bei 128 KB stehen, weil dort das
 * letzte Ereignis kam und die Wache 60 Sekunden später zuschlug. `xhr.timeout`
 * misst die Anfrage selbst und braucht kein einziges Ereignis.
 *
 * Die Grenze wächst mit der Blockgröße: eine Grundzeit plus die Zeit, die der
 * Block bei sehr langsamen 20 kB/s bräuchte. Für 4 MiB sind das gut vier
 * Minuten – großzügig genug für eine schlechte Leitung, eng genug, dass ein
 * echter Hänger auffällt.
 */
function chunkTimeoutMs(bytes: number): number {
  return 60_000 + Math.ceil(bytes / (20 * 1024)) * 1000;
}

export interface UploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  fraction: number;
}

export interface UploadHandle {
  /**
   * `uploadId` ist die Sitzung – über sie wird die Zuordnung nachgereicht.
   * `versionId` steht nur dann schon fest, wenn das Ziel von Anfang an bekannt
   * war (Kunden-Ordner, oder eine Fassung für ein bestimmtes Video).
   */
  promise: Promise<{ versionId: string | null; uploadId: string }>;
  abort: () => void;
}

/**
 * Fassung hochladen, **ohne** vorher zu wissen wohin.
 *
 * Die Übertragung ist der lange Teil, das Eintragen von Projekt und Video der
 * kurze. Also fängt sie sofort an; die Datei wartet im Zwischenspeicher, bis
 * `api.assignUpload` das Ziel nachreicht. Vorher war es umgekehrt, und wer
 * eine 90-GB-Datei ablegte, sah dem Formular beim Nichtstun zu.
 */
export function uploadVersionFile(input: {
  file: File;
  chunkSize?: number;
  onProgress?: (progress: UploadProgress) => void;
}): UploadHandle {
  return runUpload(input.file, input.chunkSize, input.onProgress, () =>
    api.createUnassignedUpload({
      filename: input.file.name,
      sizeBytes: input.file.size,
      mimeType: input.file.type || undefined,
    }),
  );
}

export function uploadVideoFile(input: {
  videoId: string;
  file: File;
  label?: string;
  /** Datum im Download-Dateinamen, `JJJJ-MM-TT`. */
  fileDate?: string;
  /** Frei gewählte Nummer (auch 2.5); ohne Angabe zählt die API weiter. */
  versionNumber?: number;
  chunkSize?: number;
  onProgress?: (progress: UploadProgress) => void;
}): UploadHandle {
  return runUpload(input.file, input.chunkSize, input.onProgress, () =>
    api.createUpload(input.videoId, {
      filename: input.file.name,
      sizeBytes: input.file.size,
      mimeType: input.file.type || undefined,
      label: input.label,
      fileDate: input.fileDate,
      versionNumber: input.versionNumber,
    }),
  );
}

/** Kunden-Upload in den Projektordner (Phase 7) – dieselbe Mechanik. */
export function uploadProjectFile(input: {
  projectId: string;
  /** Ziel-Ordner im Kunden-Bereich; leer heißt Wurzelebene (Phase 15). */
  folderId?: string;
  file: File;
  chunkSize?: number;
  onProgress?: (progress: UploadProgress) => void;
}): UploadHandle {
  return runUpload(input.file, input.chunkSize, input.onProgress, () =>
    api.createProjectFileUpload(input.projectId, {
      filename: input.file.name,
      sizeBytes: input.file.size,
      mimeType: input.file.type || undefined,
      folderId: input.folderId,
    }),
  );
}

function runUpload(
  file: File,
  chunkSizeInput: number | undefined,
  onProgress: ((progress: UploadProgress) => void) | undefined,
  createSession: () => Promise<{
    id: string;
    location: string;
    offsetBytes: number;
    versionId: string | null;
  }>,
): UploadHandle {
  const controller = new AbortController();
  const chunkSize = chunkSizeInput ?? DEFAULT_CHUNK_SIZE;
  const input = { file, onProgress };

  const promise = (async () => {
    const session = await createSession();

    let attempt = 0;
    let letzteMeldung = 0;
    let entstandeneVersion: string | null = session.versionId;

    // Vor dem ersten Block einmal `HEAD` – nicht wegen des Standes, sondern
    // wegen der *Verbindung*. Siehe `aufwaermen`.
    let offset = await aufwaermen(session.location, session.offsetBytes, controller.signal);

    report(input.onProgress, offset, input.file.size);

    while (offset < input.file.size) {
      if (controller.signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');

      const end = Math.min(offset + chunkSize, input.file.size);
      try {
        const ergebnis = await sendChunk({
          location: session.location,
          daten: await leseBlock(input.file, offset, end),
          offset,
          signal: controller.signal,
          // Der Balken soll sich innerhalb eines Blocks bewegen, nicht in
          // 8-MB-Sprüngen: Bei großen Dateien sieht ein stehender Balken sonst
          // aus wie ein Hänger, obwohl gerade übertragen wird. Gedrosselt,
          // weil sonst jeder Fortschrittsschritt die Oberfläche neu zeichnet.
          onPartial: (hochgeladen) => {
            const jetzt = Date.now();
            if (jetzt - letzteMeldung < 150) return;
            letzteMeldung = jetzt;
            report(input.onProgress, hochgeladen, input.file.size);
          },
        });
        offset = ergebnis.offset;
        // Die Fassung entsteht erst, wenn die Datei vollständig da ist – die
        // API hängt ihre Kennung deshalb an die Antwort des letzten Blocks.
        if (ergebnis.versionId) entstandeneVersion = ergebnis.versionId;
        attempt = 0;
        report(input.onProgress, offset, input.file.size);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        attempt += 1;
        if (attempt > MAX_RETRIES) {
          // Die erreichte Stelle gehört in die Meldung: Ein Upload, der immer
          // an derselben Stelle stehen bleibt, deutet auf eine Grenze im Weg
          // hin – ein zufälliger Abbruch auf eine wackelige Verbindung.
          const stelle = `${(offset / (1024 * 1024)).toFixed(0)} von ${(input.file.size / (1024 * 1024)).toFixed(0)} MB`;
          throw new Error(
            `${error instanceof Error ? error.message : 'Upload fehlgeschlagen.'} ` +
              `Abgebrochen bei ${stelle}, nach ${MAX_RETRIES} Versuchen.`,
          );
        }

        // Nach einem Fehler zählt allein der Stand des Servers: Vielleicht
        // ist ein Teil des Blocks noch angekommen, vielleicht keiner.
        await wait(Math.min(1000 * 2 ** (attempt - 1), 15000));
        offset = await fetchOffset(session.location, controller.signal);
        report(input.onProgress, offset, input.file.size);
      }
    }

    return { versionId: entstandeneVersion, uploadId: session.id };
  })();

  return {
    promise,
    abort: () => controller.abort(),
  };
}

/**
 * Den Block in den Speicher holen – und als **Blob** zurückgeben, nicht als
 * `ArrayBuffer`. Beides ist die Umgehung je eines WebKit-Fehlers, gemessen am
 * 29.07.2026 in Safari 26.5.2 mit identischer Strecke und identischen
 * Server-Protokollen:
 *
 * - Ein **dateigestützter** Body (`file.slice()` direkt verschicken) geht
 *   vollständig raus, der Server antwortet `204` – aber die Antwort wird dem
 *   XHR nie zugestellt. Er hängt bis `xhr.timeout`, viereinhalb Minuten.
 * - Ein **`ArrayBuffer`**-Body zeigt exakt dasselbe Bild. Der erste Versuch,
 *   den Datei-Fehler zu umgehen, indem der Block als `ArrayBuffer` gelesen und
 *   verschickt wurde, hat den Fehler deshalb nur verschoben: gleiche Strecke,
 *   Block kommt vollständig an, `204` geht raus, der Client sieht nichts.
 * - Nur ein **im Speicher liegender Blob** bekommt die Antwort zugestellt.
 *   Direkter Vergleich, gleiche Minute, gleicher Server: Blob 3/3 Blöcke,
 *   derselbe Inhalt als `ArrayBuffer` hängt nach Block 1.
 *
 * Deshalb: erst `arrayBuffer()` – das löst die Bindung an die Datei –, dann
 * wieder als Blob verpacken. Der Preis ist ein Block im Speicher, bei 4 MiB
 * nicht der Rede wert. Serverseitig ist derweil nichts zu holen: Proxy- und
 * API-Protokolle sind für gelungene und hängende Blöcke Feld für Feld
 * identisch. Derselbe Fehler war schon der Grund, von `fetch` auf XHR zu
 * wechseln – gewirkt hat am Ende nur die Body-Art.
 */
async function leseBlock(file: File, von: number, bis: number): Promise<Blob> {
  return new Blob([await file.slice(von, bis).arrayBuffer()]);
}

/**
 * Bewusst `XMLHttpRequest` statt `fetch`.
 *
 * `fetch` kennt keinen Fortschritt *innerhalb* einer Anfrage;
 * `upload.onprogress` schon. Das ist reine Anzeige – als Grundlage für einen
 * Abbruch taugen die Ereignisse ausdrücklich nicht (siehe `chunkTimeoutMs`).
 * Aus demselben Grund setzen auch `tus-js-client` und Uppy hier auf XHR.
 */
function sendChunk(input: {
  location: string;
  daten: Blob;
  offset: number;
  signal: AbortSignal;
  onPartial?: (uploadedBytes: number) => void;
}): Promise<{ offset: number; versionId: string | null }> {
  return new Promise<{ offset: number; versionId: string | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let erledigt = false;
    /**
     * Zwei Zahlen, die aus „es hängt“ eine Diagnose machen: wie viel der Browser
     * abgegeben hat, und ob er damit fertig wurde. Ein Block, der stehen bleibt,
     * **bevor** der Body draußen ist, wird am anderen Ende nicht abgeholt; einer,
     * der **danach** stehen bleibt, wartet auf die Antwort des Servers. Ohne
     * diese Unterscheidung sieht beides gleich aus – und genau daran ist die
     * Safari-Suche bisher gescheitert.
     */
    let abgegeben = 0;
    let bodyDraussen = false;

    const aufraeumen = () => {
      erledigt = true;
      input.signal.removeEventListener('abort', beiAbbruch);
    };
    const scheitern = (fehler: Error) => {
      if (erledigt) return;
      aufraeumen();
      reject(fehler);
    };
    const beiAbbruch = () => {
      if (erledigt) return;
      aufraeumen();
      xhr.abort();
      reject(new DOMException('Abgebrochen', 'AbortError'));
    };


    input.signal.addEventListener('abort', beiAbbruch);

    xhr.open('PATCH', `${API_BASE}${input.location}`, true);
    // Gleiche Herkunft, aber ohne diese Zeile schickt XHR das Sitzungs-Cookie
    // nicht mit, sobald API und Oberfläche getrennt veröffentlicht sind.
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/offset+octet-stream');
    xhr.setRequestHeader('Upload-Offset', String(input.offset));
    xhr.setRequestHeader('Tus-Resumable', '1.0.0');
    // Die einzige Zeitgrenze. Sie misst die Anfrage selbst, nicht die
    // Ereignisse darüber – genau deshalb überlebt eine gesunde Übertragung in
    // Safari, deren Fortschrittsmeldungen unterwegs versiegen.
    xhr.timeout = chunkTimeoutMs(input.daten.size);

    // Nur für die Anzeige und für die Fehlermeldung – aus diesen Ereignissen
    // wird **keine** Entscheidung abgeleitet, insbesondere kein Abbruch. In
    // WebKit versiegen sie mitten in einer laufenden Übertragung, und wer daran
    // einen Abbruch hängt, killt genau das, was gerade auf das Weiterlesen der
    // Gegenstelle wartet.
    xhr.upload.onprogress = (event) => {
      abgegeben = event.loaded;
      input.onPartial?.(input.offset + event.loaded);
    };
    xhr.upload.onload = () => {
      bodyDraussen = true;
      abgegeben = input.daten.size;
    };

    xhr.onerror = () =>
      scheitern(
        new Error(
          'Die Verbindung brach während der Übertragung ab (kein Kontakt zum Server) – ' +
            `nach ${abgegeben} von ${input.daten.size} Byte dieses Blocks.`,
        ),
      );
    xhr.ontimeout = () =>
      scheitern(
        new Error(
          `Der Block kam in ${Math.round(chunkTimeoutMs(input.daten.size) / 1000)} Sekunden ` +
            'nicht durch und wurde abgebrochen. ' +
            (bodyDraussen
              ? 'Die Daten waren vollständig abgegeben, die Antwort des Servers blieb aus.'
              : `Es kamen nur ${abgegeben} von ${input.daten.size} Byte heraus – die Gegenstelle ` +
                'hat sie nicht abgeholt.'),
        ),
      );
    xhr.onabort = () => {
      if (!input.signal.aborted) return;
      scheitern(new DOMException('Abgebrochen', 'AbortError'));
    };

    xhr.onload = () => {
      if (erledigt) return;
      aufraeumen();
      if (xhr.status < 200 || xhr.status >= 300) {
        // Ohne den Text des Servers steht in der Oberfläche nur eine Zahl, mit
        // der niemand etwas anfangen kann.
        reject(new Error(`Der Block wurde abgelehnt (HTTP ${xhr.status}${grund(xhr.responseText)}).`));
        return;
      }
      const neuerOffset = Number(xhr.getResponseHeader('Upload-Offset'));
      if (!Number.isFinite(neuerOffset)) {
        reject(new Error('Der Server hat keinen gültigen Upload-Offset zurückgegeben.'));
        return;
      }
      resolve({ offset: neuerOffset, versionId: xhr.getResponseHeader('Klappe-Version-Id') });
    };

    xhr.send(input.daten);
  });
}

/**
 * Warmlaufen vor dem ersten Block – gegen tote Verbindungen im Pool.
 *
 * Node schließt eine Keep-Alive-Verbindung nach kurzer Ruhe von sich aus. Der
 * Browser bekommt davon nichts mit und hält sie weiter für benutzbar. Schickt
 * Safari den ersten Block auf so eine Verbindung, **verschwindet die Anfrage
 * spurlos**: Das Schreiben gelingt (die Bytes landen im Sendepuffer, daher der
 * Balken bei 128 KB), eine Antwort kommt nie, ein Fehler auch nicht. Erst
 * `xhr.timeout` beendet das – nach über vier Minuten. Chrome fällt das nicht
 * auf, weil es eine auf einer wiederverwendeten Verbindung abgerissene Anfrage
 * selbst wiederholt; WebKit tut das bei `PATCH` nicht, und darf es auch nicht:
 * Es kann nicht wissen, ob der Server den Block schon geschrieben hat.
 *
 * `HEAD` darf es dagegen jederzeit wiederholen. Diese eine billige Anfrage
 * räumt die tote Verbindung aus dem Pool, bevor der teure Block sie erwischt.
 * Nach einem Fehlversuch passiert dasselbe ohnehin schon – nur eben zu spät.
 *
 * Die Gegenseite gehört trotzdem repariert: `KEEP_ALIVE_TIMEOUT` am Web-Dienst
 * hoch, sonst bleibt das hier Symptombekämpfung.
 */
async function aufwaermen(
  location: string,
  ersatz: number,
  signal: AbortSignal,
): Promise<number> {
  try {
    return await fetchOffset(location, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    // Das Warmlaufen ist die Vorsichtsmaßnahme, nicht der Upload. Scheitert
    // sie, wird trotzdem übertragen – der Stand aus dem Anlegen der Sitzung
    // stimmt bei einer frischen Sitzung ohnehin.
    return ersatz;
  }
}

async function fetchOffset(location: string, signal: AbortSignal): Promise<number> {
  const response = await fetch(`${API_BASE}${location}`, {
    method: 'HEAD',
    credentials: 'include',
    signal,
  });
  if (!response.ok) {
    throw new Error(`Der Upload-Stand ließ sich nicht abfragen (HTTP ${response.status}).`);
  }
  const offset = Number(response.headers.get('Upload-Offset'));
  if (!Number.isFinite(offset)) {
    throw new Error('Der Server hat keinen gültigen Upload-Offset zurückgegeben.');
  }
  return offset;
}

/**
 * Der Begründungstext des Servers, sofern er einen mitschickt. Ein Zwischenstück
 * wie ein Reverse Proxy antwortet oft mit HTML statt JSON – dann bleibt es beim
 * blanken Statuscode, statt eine Seite voll Markup in die Meldung zu kippen.
 */
function grund(rohtext: string): string {
  try {
    const text = (rohtext ?? '').slice(0, 500).trim();
    const nachricht = text.startsWith('{') ? JSON.parse(text).message : null;
    const lesbar = typeof nachricht === 'string' ? nachricht.trim().replace(/\.$/, '') : null;
    return lesbar ? ` – ${lesbar}` : '';
  } catch {
    return '';
  }
}

function report(
  onProgress: ((progress: UploadProgress) => void) | undefined,
  uploadedBytes: number,
  totalBytes: number,
): void {
  onProgress?.({
    uploadedBytes,
    totalBytes,
    fraction: totalBytes > 0 ? uploadedBytes / totalBytes : 0,
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
