'use client';

import { type DragEvent, useCallback, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { type UploadHandle, uploadVideoFile } from '@/lib/upload';

interface UploaderProps {
  projectId: string;
  /** Gesetzt: neue Version für dieses Video. Leer: neues Video je Datei. */
  videoId?: string;
  onDone: () => Promise<void> | void;
}

interface Job {
  key: string;
  filename: string;
  sizeBytes: number;
  uploadedBytes: number;
  state: 'läuft' | 'fertig' | 'fehler';
  message?: string;
  handle?: UploadHandle;
}

/**
 * Datei-Ablage mit resumable Upload. Für jede Datei wird – sofern kein Video
 * vorgegeben ist – ein Video mit dem Dateinamen angelegt und die Datei als
 * dessen erste Version hochgeladen.
 */
export function Uploader({ projectId, videoId, onDone }: UploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragging, setDragging] = useState(false);

  const patch = useCallback((key: string, changes: Partial<Job>) => {
    setJobs((current) => current.map((job) => (job.key === key ? { ...job, ...changes } : job)));
  }, []);

  const start = useCallback(
    async (files: File[]) => {
      for (const [index, file] of files.entries()) {
        const key = `${Date.now()}-${index}-${file.name}`;
        setJobs((current) => [
          ...current,
          { key, filename: file.name, sizeBytes: file.size, uploadedBytes: 0, state: 'läuft' },
        ]);

        try {
          const targetVideoId =
            videoId ??
            (await api.createVideo(projectId, { name: stripExtension(file.name) })).id;

          const handle = uploadVideoFile({
            videoId: targetVideoId,
            file,
            onProgress: (progress) => patch(key, { uploadedBytes: progress.uploadedBytes }),
          });
          patch(key, { handle });

          await handle.promise;
          patch(key, { state: 'fertig', uploadedBytes: file.size });
          await onDone();
        } catch (error) {
          patch(key, {
            state: 'fehler',
            message: error instanceof Error ? error.message : 'Upload fehlgeschlagen.',
          });
        }
      }
    },
    [projectId, videoId, patch, onDone],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files).filter((file) => file.size > 0);
    if (files.length > 0) void start(files);
  };

  return (
    <div>
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
          {videoId ? 'Neue Version hierher ziehen' : 'Videodateien hierher ziehen'}
        </strong>
        <div style={{ fontSize: 13, marginTop: 4 }}>
          oder klicken, um Dateien auszuwählen. Große Dateien werden in Blöcken übertragen und nach
          einem Abbruch fortgesetzt.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="video/*,.mov,.mp4,.mxf,.mkv,.avi,.m4v"
          multiple={!videoId}
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length > 0) void start(files);
          }}
        />
      </div>

      {jobs.length > 0 ? (
        <div className="list" style={{ marginTop: 12 }}>
          {jobs.map((job) => {
            const fraction = job.sizeBytes > 0 ? job.uploadedBytes / job.sizeBytes : 0;
            return (
              <div key={job.key} className="card" style={{ padding: '10px 14px' }}>
                <div className="toolbar" style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 14 }}>{job.filename}</span>
                  <span className="shell__spacer" />
                  <span className="muted mono" style={{ fontSize: 12 }}>
                    {formatBytes(job.uploadedBytes)} / {formatBytes(job.sizeBytes)}
                  </span>
                  {job.state === 'läuft' ? (
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => job.handle?.abort()}
                    >
                      Abbrechen
                    </button>
                  ) : null}
                  {job.state === 'fertig' ? <span className="badge badge--ready">Fertig</span> : null}
                  {job.state === 'fehler' ? <span className="badge badge--failed">Fehler</span> : null}
                </div>
                <div className="progress">
                  <div className="progress__bar" style={{ width: `${fraction * 100}%` }} />
                </div>
                {job.message ? (
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    {job.message}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function stripExtension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index > 0 ? filename.slice(0, index) : filename;
}
