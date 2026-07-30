'use client';

import type { ProjectDto, VideoDto } from '@klappe/shared';
import { type DragEvent, useRef, useState } from 'react';
import { useUploads } from '@/lib/uploads-context';

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
 */
export function Uploader({
  projectId,
  videoId,
  target = 'video',
  folderId,
  projects,
  videos,
}: UploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
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

  return (
    <div
      className="empty"
      style={{
        borderColor: dragging ? 'var(--klappe-accent)' : undefined,
        cursor: 'pointer',
        padding: '28px 20px',
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter') inputRef.current?.click();
      }}
    >
      <strong style={{ color: 'var(--klappe-text)' }}>
        {target === 'project-file'
          ? 'Material hierher ziehen'
          : videoId
            ? 'Neue Fassung hierher ziehen'
            : 'Videodateien hierher ziehen'}
      </strong>
      <div style={{ fontSize: 13, marginTop: 4 }}>
        Mehrere Dateien auf einmal sind möglich. Zuordnung und Fortschritt stehen danach im
        Upload-Fenster; abgerissene Übertragungen werden fortgesetzt.
        {target === 'project-file' ? (
          <>
            {' '}
            <button
              type="button"
              className="button button--ghost"
              style={{ marginLeft: 6, padding: '2px 10px', fontSize: 12 }}
              onClick={(event) => {
                event.stopPropagation();
                folderInputRef.current?.click();
              }}
            >
              Ganzen Ordner wählen …
            </button>
          </>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={target === 'project-file' ? undefined : 'video/*,.mov,.mp4,.mxf,.mkv,.avi,.m4v'}
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          accept(files);
        }}
      />
      {target === 'project-file' ? (
        // Ein zweites Eingabefeld nur für Ordner: `webkitdirectory` liefert
        // jede Datei mit ihrem relativen Pfad, aus dem die Ordnerkette entsteht.
        <input
          ref={folderInputRef}
          type="file"
          hidden
          multiple
          // @ts-expect-error – Nicht im Standard, aber in allen Browsern.
          webkitdirectory=""
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            accept(files);
          }}
        />
      ) : null}
    </div>
  );
}
