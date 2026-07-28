'use client';

import {
  type ProjectDto,
  type VideoDto,
  detectVersionNumber,
  formatFileDate,
  matchProject,
  matchVideo,
  suggestVideoName,
} from '@klappe/shared';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from './api';
import { type UploadHandle, uploadProjectFile, uploadVideoFile } from './upload';

export type UploadTarget = 'video' | 'project-file';

export interface UploadJob {
  id: string;
  file: File;
  target: UploadTarget;
  /** Zuordnung, die der Benutzer im Fenster noch ändern kann. */
  projectId: string;
  /** Leer = neues Video anlegen. */
  videoId: string;
  /** Name für ein neu anzulegendes Video. */
  newVideoName: string;
  /** Erkannte Versionsnummer; dient nur der Anzeige, vergeben wird sie serverseitig. */
  detectedVersion: number | null;
  /** Datum im Dateinamen, `JJJJ-MM-TT`. */
  fileDate: string;
  /** Woher die Vorauswahl kommt – die Oberfläche bittet dann ums Prüfen. */
  hint: string | null;
  state: 'wartet' | 'lädt' | 'verarbeitet' | 'fertig' | 'fehler' | 'abgebrochen';
  uploadedBytes: number;
  /** Fortschritt des Transcodings in Prozent, sobald die Datei durch ist. */
  transcodeProgress: number;
  versionId: string | null;
  message?: string;
  handle?: UploadHandle;
}

interface UploadsState {
  jobs: UploadJob[];
  open: boolean;
  /** Dateien in die Warteschlange legen und das Fenster öffnen. */
  enqueue: (input: {
    files: File[];
    target: UploadTarget;
    projectId: string;
    videoId?: string;
    projects?: ProjectDto[];
    videos?: VideoDto[];
  }) => void;
  update: (id: string, changes: Partial<UploadJob>) => void;
  start: () => void;
  cancel: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  setOpen: (open: boolean) => void;
  /** Zähler, der sich nach jedem abgeschlossenen Upload erhöht. */
  completedCount: number;
}

const UploadsContext = createContext<UploadsState | null>(null);

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Hält die Upload-Warteschlange für die ganze Anwendung.
 *
 * Bewusst im Wurzel-Layout verankert: Dadurch laufen Uploads weiter, während
 * man durch Projekte blättert, und das Fenster lässt sich schließen und
 * wieder öffnen, ohne dass etwas abbricht.
 */
export function UploadsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [open, setOpen] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);
  /** Läuft die Abarbeitung gerade? Verhindert zwei Schleifen nebeneinander. */
  const running = useRef(false);
  const jobsRef = useRef<UploadJob[]>([]);
  jobsRef.current = jobs;

  const update = useCallback((id: string, changes: Partial<UploadJob>) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...changes } : job)));
  }, []);

  const enqueue = useCallback<UploadsState['enqueue']>((input) => {
    const heute = todayIso();

    const neue: UploadJob[] = input.files.map((file, index) => {
      const projectHint = input.projects ? matchProject(file.name, input.projects) : null;
      const projectId = input.projectId || projectHint?.projectId || input.projects?.[0]?.id || '';

      // Videos zum vorgeschlagenen Projekt für die Zuordnung heranziehen.
      const videosOfProject = (input.videos ?? []).filter(
        (video) => video.projectId === projectId,
      );
      const videoId = input.videoId ?? matchVideo(file.name, videosOfProject) ?? '';

      const hints: string[] = [];
      if (!input.projectId && projectHint) {
        hints.push(`Projekt anhand von „${projectHint.matched.join(', ')}“ vorgeschlagen`);
      }
      if (!input.videoId && videoId) hints.push('als neue Fassung eines vorhandenen Videos erkannt');
      const version = detectVersionNumber(file.name);
      if (version) hints.push(`Version ${version} im Dateinamen erkannt`);

      return {
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        target: input.target,
        projectId,
        videoId,
        newVideoName: suggestVideoName(file.name),
        detectedVersion: version,
        fileDate: heute,
        hint: hints.length > 0 ? `${hints.join(' · ')} – bitte prüfen` : null,
        state: 'wartet',
        uploadedBytes: 0,
        transcodeProgress: 0,
        versionId: null,
      };
    });

    setJobs((current) => [...current, ...neue]);
    setOpen(true);
  }, []);

  /**
   * Arbeitet die Warteschlange der Reihe nach ab. Nacheinander statt parallel:
   * Bei großen Dateien teilen sich gleichzeitige Uploads nur die Leitung und
   * jeder einzelne dauert länger.
   */
  const start = useCallback(() => {
    if (running.current) return;
    running.current = true;

    void (async () => {
      try {
        for (;;) {
          const job = jobsRef.current.find((entry) => entry.state === 'wartet');
          if (!job) break;

          update(job.id, { state: 'lädt', message: undefined });
          try {
            const onProgress = (progress: { uploadedBytes: number }) =>
              update(job.id, { uploadedBytes: progress.uploadedBytes });

            let handle: UploadHandle;
            if (job.target === 'project-file') {
              handle = uploadProjectFile({ projectId: job.projectId, file: job.file, onProgress });
            } else {
              const videoId =
                job.videoId ||
                (
                  await api.createVideo(job.projectId, {
                    name: job.newVideoName.trim() || job.file.name,
                  })
                ).id;
              handle = uploadVideoFile({
                videoId,
                file: job.file,
                fileDate: job.fileDate,
                onProgress,
              });
              update(job.id, { videoId });
            }

            update(job.id, { handle });
            const result = await handle.promise;
            update(job.id, {
              state: job.target === 'project-file' ? 'fertig' : 'verarbeitet',
              uploadedBytes: job.file.size,
              versionId: result.versionId,
            });
            setCompletedCount((count) => count + 1);
          } catch (error) {
            const aborted = error instanceof DOMException && error.name === 'AbortError';
            update(job.id, {
              state: aborted ? 'abgebrochen' : 'fehler',
              message: aborted
                ? 'Abgebrochen.'
                : error instanceof Error
                  ? error.message
                  : 'Upload fehlgeschlagen.',
            });
          }
        }
      } finally {
        running.current = false;
      }
    })();
  }, [update]);

  const cancel = useCallback((id: string) => {
    const job = jobsRef.current.find((entry) => entry.id === id);
    job?.handle?.abort();
  }, []);

  const remove = useCallback((id: string) => {
    setJobs((current) => current.filter((job) => job.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setJobs((current) =>
      current.filter((job) => job.state !== 'fertig' && job.state !== 'abgebrochen'),
    );
  }, []);

  const value = useMemo(
    () => ({
      jobs,
      open,
      enqueue,
      update,
      start,
      cancel,
      remove,
      clearFinished,
      setOpen,
      completedCount,
    }),
    [jobs, open, enqueue, update, start, cancel, remove, clearFinished, completedCount],
  );

  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

export function useUploads(): UploadsState {
  const context = useContext(UploadsContext);
  if (!context) throw new Error('useUploads muss innerhalb von <UploadsProvider> benutzt werden.');
  return context;
}
