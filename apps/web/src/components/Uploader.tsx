'use client';

import type { ProjectDto, VideoDto } from '@klappe/shared';
import { type DragEvent, useState } from 'react';
import { pickFiles } from '@/lib/pick-files';
import { useUploads } from '@/lib/uploads-context';

/** Was als Video durchgeht; für die Kunden-Ablage gilt keine Einschränkung. */
export const VIDEO_ACCEPT = 'video/*,.mov,.mp4,.mxf,.mkv,.avi,.m4v';

interface UploaderProps {
  projectId: string;
  /** Gesetzt: neue Fassung für dieses Video. Leer: Zuordnung im Fenster. */
  videoId?: string;
  /** `project-file` legt die Datei in den Kunden-Ordner statt als Video an. */
  target?: 'video' | 'project-file';
  /** Ziel-Ordner im Kunden-Bereich; leer heißt Wurzelebene (Phase 15). */
  folderId?: string;
  /** Für die Vorauswahl im Upload-Fenster. */
  projects?: ProjectDto[];
  videos?: VideoDto[];
}

/**
 * Ablagefläche für Dateien.
 *
 * Sie nimmt nur entgegen – Zuordnung, Fortschritt und Abbruch stehen im
 * Upload-Fenster (`UploadPanel`), das über allen Seiten liegt und beim
 * Blättern nicht verschwindet.
 *
 * Seit Phase 24 steht hier ein richtiger Knopf. „Hierher ziehen" ist auf einem
 * Handy eine Anweisung ins Leere: Es gibt nichts zu ziehen, und dass die Fläche
 * insgesamt anklickbar war, sah man ihr nicht an. Der Ziehen-Hinweis bleibt
 * Geräten mit Zeiger vorbehalten.
 */
export function Uploader({
  projectId,
  videoId,
  target = 'video',
  folderId,
  projects,
  videos,
}: UploaderProps) {
  const [dragging, setDragging] = useState(false);
  const { enqueue } = useUploads();

  const accept = (files: File[]) => {
    const usable = files.filter((file) => file.size > 0);
    if (usable.length === 0) return;
    enqueue({ files: usable, target, projectId, videoId, folderId, projects, videos });
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

  const titel =
    target === 'project-file'
      ? 'Material hinzufügen'
      : videoId
        ? 'Neue Fassung hinzufügen'
        : 'Videodateien hinzufügen';

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
      <strong className="dropzone__title">{titel}</strong>

      <p className="dropzone__hint">
        <span className="dropzone__draghint">Dateien hierher ziehen oder unten auswählen. </span>
        Mehrere Dateien auf einmal sind möglich. Zuordnung und Fortschritt stehen danach im
        Upload-Fenster; abgerissene Übertragungen werden fortgesetzt.
      </p>

      <div className="dropzone__actions">
        <button type="button" className="button button--primary" onClick={() => void waehlen()}>
          Dateien auswählen …
        </button>
        {target === 'project-file' ? (
          <button type="button" className="button" onClick={() => void waehlen(true)}>
            Ganzen Ordner wählen …
          </button>
        ) : null}
      </div>
    </div>
  );
}
