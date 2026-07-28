import { API_BASE, api } from './api';

/**
 * Client für den resumable Upload (tus-Semantik, siehe `apps/api/src/uploads`).
 *
 * Die Datei wird in Blöcken geschickt. Reißt die Verbindung ab, fragt der
 * Client per `HEAD` den Stand beim Server ab und macht genau dort weiter –
 * bei 40-GB-Kameramaterial über WLAN ist das der Unterschied zwischen
 * „nochmal von vorn“ und „läuft weiter“.
 */
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_RETRIES = 5;

export interface UploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  fraction: number;
}

export interface UploadHandle {
  /** `versionId` ist nur beim Video-Upload gesetzt, nicht beim Kunden-Ordner. */
  promise: Promise<{ versionId: string | null }>;
  abort: () => void;
}

export function uploadVideoFile(input: {
  videoId: string;
  file: File;
  label?: string;
  /** Datum im Download-Dateinamen, `JJJJ-MM-TT`. */
  fileDate?: string;
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
  createSession: () => Promise<{ location: string; offsetBytes: number; versionId: string | null }>,
): UploadHandle {
  const controller = new AbortController();
  const chunkSize = chunkSizeInput ?? DEFAULT_CHUNK_SIZE;
  const input = { file, onProgress };

  const promise = (async () => {
    const session = await createSession();

    let offset = session.offsetBytes;
    let attempt = 0;

    report(input.onProgress, offset, input.file.size);

    while (offset < input.file.size) {
      if (controller.signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');

      const end = Math.min(offset + chunkSize, input.file.size);
      try {
        offset = await sendChunk({
          location: session.location,
          blob: input.file.slice(offset, end),
          offset,
          signal: controller.signal,
        });
        attempt = 0;
        report(input.onProgress, offset, input.file.size);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        attempt += 1;
        if (attempt > MAX_RETRIES) throw error;

        // Nach einem Fehler zählt allein der Stand des Servers: Vielleicht
        // ist ein Teil des Blocks noch angekommen, vielleicht keiner.
        await wait(Math.min(1000 * 2 ** (attempt - 1), 15000));
        offset = await fetchOffset(session.location, controller.signal);
        report(input.onProgress, offset, input.file.size);
      }
    }

    return { versionId: session.versionId };
  })();

  return {
    promise,
    abort: () => controller.abort(),
  };
}

async function sendChunk(input: {
  location: string;
  blob: Blob;
  offset: number;
  signal: AbortSignal;
}): Promise<number> {
  const response = await fetch(`${API_BASE}${input.location}`, {
    method: 'PATCH',
    credentials: 'include',
    signal: input.signal,
    headers: {
      'Content-Type': 'application/offset+octet-stream',
      'Upload-Offset': String(input.offset),
      'Tus-Resumable': '1.0.0',
    },
    body: input.blob,
  });

  if (!response.ok) {
    throw new Error(`Der Block wurde abgelehnt (HTTP ${response.status}).`);
  }

  const newOffset = Number(response.headers.get('Upload-Offset'));
  if (!Number.isFinite(newOffset)) {
    throw new Error('Der Server hat keinen gültigen Upload-Offset zurückgegeben.');
  }
  return newOffset;
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
