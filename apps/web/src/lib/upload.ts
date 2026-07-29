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
  file: File;
  chunkSize?: number;
  onProgress?: (progress: UploadProgress) => void;
}): UploadHandle {
  return runUpload(input.file, input.chunkSize, input.onProgress, () =>
    api.createProjectFileUpload(input.projectId, {
      filename: input.file.name,
      sizeBytes: input.file.size,
      mimeType: input.file.type || undefined,
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

    let offset = session.offsetBytes;
    let attempt = 0;
    let letzteMeldung = 0;
    let entstandeneVersion: string | null = session.versionId;

    report(input.onProgress, offset, input.file.size);

    while (offset < input.file.size) {
      if (controller.signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');

      const end = Math.min(offset + chunkSize, input.file.size);
      try {
        const ergebnis = await sendChunk({
          location: session.location,
          blob: input.file.slice(offset, end),
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
 * Bewusst `XMLHttpRequest` statt `fetch`.
 *
 * Safari bleibt bei `fetch` mit Datei-Body reproduzierbar stehen: Die Anfrage
 * geht raus, es kommt weder Antwort noch Fehler, und das Versprechen löst sich
 * nie auf. In Chrome läuft dieselbe Datei durch. Aus demselben Grund setzen
 * auch `tus-js-client` und Uppy hier auf XHR.
 *
 * Der zweite Gewinn: `upload.onprogress` meldet den Fortschritt *innerhalb*
 * eines Blocks – `fetch` kennt das nicht. Das ist reine Anzeige; als Grundlage
 * für einen Abbruch taugen die Ereignisse ausdrücklich nicht (siehe
 * `chunkTimeoutMs`).
 */
function sendChunk(input: {
  location: string;
  blob: Blob;
  offset: number;
  signal: AbortSignal;
  onPartial?: (uploadedBytes: number) => void;
}): Promise<{ offset: number; versionId: string | null }> {
  return new Promise<{ offset: number; versionId: string | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let erledigt = false;

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
    xhr.timeout = chunkTimeoutMs(input.blob.size);

    // Nur noch für die Anzeige – aus diesen Ereignissen wird **keine**
    // Entscheidung mehr abgeleitet. In WebKit versiegen sie mitten in einer
    // laufenden Übertragung, und wer daran einen Abbruch hängt, killt genau
    // das, was gerade funktioniert.
    xhr.upload.onprogress = (event) => {
      input.onPartial?.(input.offset + event.loaded);
    };

    xhr.onerror = () =>
      scheitern(
        new Error(
          'Die Verbindung brach während der Übertragung ab (kein Kontakt zum Server).',
        ),
      );
    xhr.ontimeout = () =>
      scheitern(
        new Error(
          `Der Block kam in ${Math.round(chunkTimeoutMs(input.blob.size) / 1000)} Sekunden ` +
            'nicht durch und wurde abgebrochen.',
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

    xhr.send(input.blob);
  });
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
