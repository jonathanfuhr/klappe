'use client';

import type { VideoDto } from '@klappe/shared';
import { type DragEvent, useState } from 'react';
import { VIDEO_ACCEPT, pickFiles } from '@/lib/pick-files';
import { useUploads } from '@/lib/uploads-context';

interface UploaderProps {
  projectId: string;
  /** Gesetzt: neue Fassung für dieses Video. Leer: Zuordnung im Fenster. */
  videoId?: string;
  /** `project-file` legt die Datei in den Kunden-Ordner statt als Video an. */
  target?: 'video' | 'project-file';
  /** Ziel-Ordner im Kunden-Bereich; leer heißt Wurzelebene (Phase 15). */
  folderId?: string;
  /** Für die Vorauswahl im Upload-Fenster: erkennt neue Fassungen am Namen. */
  videos?: VideoDto[];
}

/**
 * Ablagefläche für Dateien.
 *
 * Sie nimmt nur entgegen – Zuordnung, Fortschritt und Abbruch stehen im
 * Upload-Fenster (`UploadPanel`), das über allen Seiten liegt und beim
 * Blättern nicht verschwindet.
 *
 * Am Schreibtisch ist das Ziehen aus dem Finder der schnellste Weg, gerade bei
 * mehreren Dateien auf einmal – deshalb bleibt die Fläche dort. Auf einem
 * Gerät ohne Zeiger gibt es nichts zu ziehen; der Ziehen-Hinweis entfällt
 * dort, und der Knopf darunter trägt den Fall allein (Phase 24).
 */
export function Uploader({ projectId, videoId, target = 'video', folderId, videos }: UploaderProps) {
  const [dragging, setDragging] = useState(false);
  const { enqueue } = useUploads();

  const accept = (files: File[]) => {
    const usable = files.filter((file) => file.size > 0);
    if (usable.length === 0) return;
    enqueue({ files: usable, target, projectId, videoId, folderId, videos });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(Array.from(event.dataTransfer.files));
  };

  const waehlen = async (directory = false) => {
    accept(
      await pickFiles({
        accept: target === 'project-file' ? undefined : VIDEO_ACCEPT,
        directory,
      }),
    );
  };

  const istKundenAblage = target === 'project-file';

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
      <strong className="dropzone__title">
        {istKundenAblage
          ? 'Material hinzufügen'
          : videoId
            ? 'Neue Fassung hinzufügen'
            : 'Videodateien hinzufügen'}
      </strong>

      <p className="dropzone__hint">
        <span className="dropzone__draghint">Dateien hierher ziehen oder unten auswählen. </span>
        Mehrere Dateien auf einmal sind möglich. Zuordnung und Fortschritt stehen danach im
        Upload-Fenster; abgerissene Übertragungen werden fortgesetzt.
      </p>

      <div className="dropzone__actions">
        <button type="button" className="button button--primary" onClick={() => void waehlen()}>
          Dateien auswählen …
        </button>
        {istKundenAblage ? (
          <button type="button" className="button" onClick={() => void waehlen(true)}>
            Ganzen Ordner wählen …
          </button>
        ) : null}
      </div>
    </div>
  );
}
