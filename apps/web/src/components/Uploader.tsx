'use client';

import { type DragEvent, useState } from 'react';
import { pickFiles } from '@/lib/pick-files';
import { useUploads } from '@/lib/uploads-context';

/**
 * Ablagefläche für die Kunden-Ablage eines Projekts.
 *
 * Sie nimmt nur entgegen – Zuordnung, Fortschritt und Abbruch stehen im
 * Upload-Fenster (`UploadPanel`), das über allen Seiten liegt und beim
 * Blättern nicht verschwindet.
 *
 * Seit Phase 24 gibt es sie nur noch hier. Für Videos steht stattdessen ein
 * „+" in der Kopfzeile, das direkt die Dateiauswahl öffnet: „Hierher ziehen"
 * ist auf einem Handy eine Anweisung ins Leere, und eine Fläche samt Erklärung
 * mitten auf der Seite war für einen seltenen Handgriff zu viel. In der
 * Kunden-Ablage bleibt sie, weil dort ganze Ordner am Stück hereinkommen – und
 * das geht am Schreibtisch mit dem Mauszeiger am schnellsten.
 */
export function Uploader({
  projectId,
  /** Ziel-Ordner im Kunden-Bereich; leer heißt Wurzelebene (Phase 15). */
  folderId,
}: {
  projectId: string;
  folderId?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const { enqueue } = useUploads();

  const accept = (files: File[]) => {
    const usable = files.filter((file) => file.size > 0);
    if (usable.length === 0) return;
    enqueue({ files: usable, target: 'project-file', projectId, folderId });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(Array.from(event.dataTransfer.files));
  };

  const waehlen = async (directory = false) => {
    accept(await pickFiles({ directory }));
  };

  return (
    <div
      className="empty dropzone"
      data-dragging={dragging}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <strong className="dropzone__title">Material hinzufügen</strong>

      <p className="dropzone__hint">
        <span className="dropzone__draghint">Dateien hierher ziehen oder unten auswählen. </span>
        Mehrere Dateien auf einmal sind möglich. Zuordnung und Fortschritt stehen danach im
        Upload-Fenster; abgerissene Übertragungen werden fortgesetzt.
      </p>

      <div className="dropzone__actions">
        <button type="button" className="button button--primary" onClick={() => void waehlen()}>
          Dateien auswählen …
        </button>
        <button type="button" className="button" onClick={() => void waehlen(true)}>
          Ganzen Ordner wählen …
        </button>
      </div>
    </div>
  );
}
