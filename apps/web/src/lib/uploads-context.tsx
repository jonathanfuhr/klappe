'use client';

import {
  type ProjectDto,
  type VideoDto,
  detectVersionNumber,
  matchProject,
  matchVideo,
  suggestVideoName,
} from '@klappe/shared';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api } from './api';
import { type Translator, useT } from './i18n';
import {
  type UploadHandle,
  UploadTransportError,
  uploadProjectFile,
  uploadVersionFile,
} from './upload';

export type UploadTarget = 'video' | 'project-file';

export interface UploadJob {
  id: string;
  /**
   * Fehlt nach einem Seiten-Reload: Die Bytes liegen dann längst auf dem
   * Server, nur die Zuordnung steht noch aus. Name und Größe stehen deshalb
   * getrennt, damit die Zeile auch ohne Datei-Objekt vollständig ist.
   */
  file?: File;
  filename: string;
  sizeBytes: number;
  target: UploadTarget;
  /** Ziel-Ordner im Kunden-Bereich, nur bei `project-file` (Phase 15). */
  folderId?: string;
  /** Zuordnung, die der Benutzer im Fenster noch ändern kann. */
  projectId: string;
  /** Leer = neues Video anlegen. */
  videoId: string;
  /** Name für ein neu anzulegendes Video. */
  newVideoName: string;
  /**
   * Hat jemand den Namen selbst angefasst (Phase 25)? Solange nicht, darf das
   * Upload-Fenster den Vorschlag nachschärfen – etwa Kunden- und Projektname
   * herausnehmen, sobald das Ziel-Projekt feststeht.
   */
  nameBeruehrt?: boolean;
  /** Erkannte Versionsnummer aus dem Dateinamen – Vorschlag fürs Feld. */
  detectedVersion: number | null;
  /**
   * Gewünschte Nummer als Eingabetext, damit „2." beim Tippen nicht wegspringt.
   * Leer heißt: Klappe zählt selbst weiter.
   */
  versionNumber: string;
  /** Datum im Dateinamen, `JJJJ-MM-TT`. */
  fileDate: string;
  /**
   * Interne Fassung (Phase 27): Sie geht erst nach ausdrücklicher Freigabe an
   * den Kunden. Der Haken steht an jeder Zeile einzeln – im Multi-Upload
   * kommen oft mehrere Filme zugleich, und nicht jeder braucht die interne
   * Runde.
   */
  internal: boolean;
  /** Woher die Vorauswahl kommt – die Oberfläche bittet dann ums Prüfen. */
  hint: string | null;
  state: 'wartet' | 'lädt' | 'bereit' | 'verarbeitet' | 'fertig' | 'fehler' | 'abgebrochen';
  /** Die Upload-Sitzung – über sie wird die Zuordnung nachgereicht. */
  uploadId: string | null;
  /**
   * Schon gespeichert, während die Übertragung noch läuft (Phase 18)? Dann
   * nimmt die API die Datei auf, sobald der letzte Block da ist – hier muss
   * niemand mehr klicken.
   */
  gespeichert: boolean;
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
    folderId?: string;
    projects?: ProjectDto[];
    videos?: VideoDto[];
  }) => void;
  update: (id: string, changes: Partial<UploadJob>) => void;
  start: () => void;
  /** Zuordnung eines fertig übertragenen Jobs übernehmen (Phase 15). */
  save: (id: string) => void;
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
  const t = useT();
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  /**
   * `start` entsteht weiter unten, der Auto-Start braucht es aber schon hier.
   * Über die Box bleibt die Reihenfolge der Deklarationen sauber.
   */
  const startRef = useRef<(() => void) | null>(null);
  /** Verhindert, dass derselbe Job zweimal gleichzeitig aufgenommen wird. */
  const uebernahmeLaeuft = useRef<Set<string>>(new Set());
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
        hints.push(t('upload.hintProject', { words: projectHint.matched.join(', ') }));
      }
      if (!input.videoId && videoId) hints.push(t('upload.hintNewVersion'));
      const version = detectVersionNumber(file.name);
      if (version) hints.push(t('upload.hintVersion', { number: version }));

      return {
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        filename: file.name,
        sizeBytes: file.size,
        target: input.target,
        folderId: input.folderId,
        projectId,
        videoId,
        newVideoName: suggestVideoName(file.name),
        detectedVersion: version,
        versionNumber: '',
        fileDate: heute,
        internal: false,
        hint: hints.length > 0 ? t('upload.hintCheck', { hints: hints.join(' · ') }) : null,
        state: 'wartet',
        uploadedBytes: 0,
        transcodeProgress: 0,
        uploadId: null,
        gespeichert: false,
        versionId: null,
      };
    });

    setJobs((current) => [...current, ...neue]);
    setOpen(true);
  }, []);

  /**
   * Losschicken, sobald etwas da ist – und nicht erst, wenn alles eingestellt
   * ist. Die Übertragung ist der langsame Teil; sie im Hintergrund laufen zu
   * lassen, während man Namen und Datum prüft, spart bei großen Dateien
   * Minuten. Wer kein Projekt vorgegeben hat, bleibt liegen, bis er eines
   * wählt: Ohne Ziel gibt es keine Sitzung.
   */
  useEffect(() => {
    if (
      jobs.some(
        (job) => job.state === 'wartet' && (job.target === 'video' || Boolean(job.projectId)),
      )
    ) {
      startRef.current?.();
    }
  }, [jobs]);

  /**
   * Arbeitet die Warteschlange der Reihe nach ab. Nacheinander statt parallel:
   * Bei großen Dateien teilen sich gleichzeitige Uploads nur die Leitung und
   * jeder einzelne dauert länger.
   *
   * Videofassungen gehen **ohne Ziel** los: Die Datei landet im
   * Zwischenspeicher, während im Fenster noch Projekt und Video eingetragen
   * werden. Aufgenommen wird sie erst in `uebernehmen`.
   */
  const start = useCallback(() => {
    if (running.current) return;
    running.current = true;

    void (async () => {
      try {
        for (;;) {
          // Kunden-Uploads brauchen weiter ein Projekt – dort gibt es keine
          // Zuordnung, die man später nachreichen könnte.
          const job = jobsRef.current.find(
            (entry) =>
              entry.state === 'wartet' &&
              entry.file !== undefined &&
              (entry.target === 'video' || Boolean(entry.projectId)),
          );
          if (!job?.file) break;
          const datei = job.file;

          update(job.id, { state: 'lädt', message: undefined });
          try {
            const onProgress = (progress: { uploadedBytes: number }) =>
              update(job.id, { uploadedBytes: progress.uploadedBytes });

            // Kommt die Datei aus einem gewählten Ordner, trägt sie ihren
            // relativen Pfad – die Ordnerkette entsteht vor der Übertragung,
            // damit zwei Dateien aus demselben Unterordner ihn teilen.
            let zielOrdner = job.folderId;
            const relativ = (datei as File & { webkitRelativePath?: string }).webkitRelativePath;
            if (job.target === 'project-file' && relativ && relativ.includes('/')) {
              const segmente = relativ.split('/').slice(0, -1).filter(Boolean);
              if (segmente.length > 0) {
                const ordner = await api.ensureProjectFolderPath(job.projectId, {
                  parentId: job.folderId || undefined,
                  path: segmente,
                });
                zielOrdner = ordner.id;
              }
            }

            const handle: UploadHandle =
              job.target === 'project-file'
                ? uploadProjectFile({
                    projectId: job.projectId,
                    folderId: zielOrdner,
                    file: datei,
                    onProgress,
                  })
                : uploadVersionFile({
                    file: datei,
                    onProgress,
                    // Die Kennung kommt sofort, nicht erst am Ende: Damit
                    // lässt sich schon während der Übertragung speichern.
                    onSession: (uploadId) => update(job.id, { uploadId }),
                  });

            update(job.id, { handle });
            const result = await handle.promise;

            if (job.target === 'project-file') {
              update(job.id, {
                state: 'fertig',
                uploadedBytes: datei.size,
                versionId: result.versionId,
              });
              setCompletedCount((count) => count + 1);
            } else {
              // Wer schon während der Übertragung gespeichert hat, ist fertig:
              // Die API nimmt die Datei mit dem letzten Block selbst auf.
              // Sonst wartet sie im Zwischenspeicher auf den Knopf.
              const aktuell = jobsRef.current.find((eintrag) => eintrag.id === job.id);
              update(job.id, {
                state: aktuell?.gespeichert ? 'verarbeitet' : 'bereit',
                uploadedBytes: datei.size,
                uploadId: result.uploadId,
                versionId: result.versionId ?? aktuell?.versionId ?? null,
              });
              if (aktuell?.gespeichert) setCompletedCount((count) => count + 1);
            }
          } catch (error) {
            const aborted = error instanceof DOMException && error.name === 'AbortError';
            update(job.id, {
              state: aborted ? 'abgebrochen' : 'fehler',
              message: aborted ? t('upload.aborted') : uebersetzeFehler(error, t),
            });
          }
        }
      } finally {
        running.current = false;
      }
    })();
  }, [update]);

  startRef.current = start;

  /**
   * Die zweite Hälfte: Die Datei ist da, jetzt kommt sie ins Projekt. Passiert
   * von selbst, sobald Projekt und Video feststehen – ob das vor oder nach dem
   * Ende der Übertragung geschieht, spielt keine Rolle mehr.
   */
  const uebernehmen = useCallback(
    async (job: UploadJob) => {
      if (!job.uploadId || !job.projectId) return;
      // Läuft die Übertragung noch, wird das Ziel nur hinterlegt; die API
      // nimmt die Datei dann mit dem letzten Block von selbst auf (Phase 18).
      const laeuftNoch = job.state === 'lädt';
      uebernahmeLaeuft.current.add(job.id);
      try {
        const videoId =
          job.videoId ||
          (await api.createVideo(job.projectId, { name: job.newVideoName.trim() || job.filename }))
            .id;
        const wunsch = job.versionNumber.trim()
          ? Number(job.versionNumber.replace(',', '.'))
          : undefined;

        const sitzung = await api.assignUpload(job.uploadId, {
          videoId,
          fileDate: job.fileDate || undefined,
          ...(Number.isFinite(wunsch) ? { versionNumber: wunsch } : {}),
          internal: job.internal,
        });

        update(job.id, {
          state: laeuftNoch ? 'lädt' : 'verarbeitet',
          gespeichert: true,
          videoId,
          versionId: sitzung.versionId,
          message: undefined,
        });
        if (!laeuftNoch) setCompletedCount((count) => count + 1);
      } catch (error) {
        // Kein Datenverlust: Die Datei bleibt im Zwischenspeicher liegen, der
        // Fehler betrifft nur die Zuordnung. Deshalb zurück in den Zustand,
        // aus dem der Klick kam.
        update(job.id, {
          state: laeuftNoch ? 'lädt' : 'bereit',
          gespeichert: false,
          message:
            error instanceof Error ? error.message : t('upload.assignFailed'),
        });
      } finally {
        uebernahmeLaeuft.current.delete(job.id);
      }
    },
    [update],
  );

  /**
   * Aufgenommen wird erst auf Knopfdruck (Phase 15). Vorher lief die Übernahme
   * automatisch los, sobald Projekt und Video feststanden – wer in Ruhe die
   * Nummer oder das Datum prüfen wollte, kam zu spät. Jetzt bleibt die Zeile
   * so lange offen, bis „Speichern“ gedrückt ist; ohne das entsteht weder
   * Video noch Fassung, und die Datei wartet im Zwischenspeicher.
   */
  const save = useCallback(
    (id: string) => {
      const job = jobsRef.current.find((entry) => entry.id === id);
      if (!job || uebernahmeLaeuft.current.has(job.id) || job.gespeichert) return;
      // Seit Phase 18 geht das auch mitten in der Übertragung – sobald die
      // Sitzung steht. Wer die Angaben schon beisammen hat, muss nicht warten,
      // bis die letzten Gigabyte durch sind.
      if (job.state !== 'bereit' && job.state !== 'lädt') return;
      if (!job.uploadId) return;
      if (!job.projectId) return;
      // Ein neues Video braucht wenigstens einen Namen.
      if (!job.videoId && !job.newVideoName.trim()) return;
      void uebernehmen(job);
    },
    [uebernehmen],
  );

  /**
   * Einmal beim Start: fertig übertragene, noch unzugeordnete Sitzungen vom
   * Server zurückholen. Die Upload-Liste überlebt so einen Seiten-Reload –
   * die Bytes liegen ja längst im Zwischenspeicher.
   */
  const wiederhergestellt = useRef(false);
  useEffect(() => {
    if (wiederhergestellt.current) return;
    wiederhergestellt.current = true;
    void (async () => {
      try {
        const sitzungen = await api.listUnassignedUploads();
        const bekannt = new Set(jobsRef.current.map((job) => job.uploadId).filter(Boolean));
        const heute = todayIso();
        const neue: UploadJob[] = sitzungen
          .filter((sitzung) => !bekannt.has(sitzung.id))
          .map((sitzung) => ({
            id: `wieder-${sitzung.id}`,
            filename: sitzung.filename,
            sizeBytes: sitzung.sizeBytes,
            target: 'video',
            projectId: '',
            videoId: '',
            newVideoName: suggestVideoName(sitzung.filename),
            detectedVersion: detectVersionNumber(sitzung.filename),
            versionNumber: '',
            fileDate: heute,
            // Der Haken hat den Reload überlebt – er steht an der Sitzung.
            internal: sitzung.internal,
            hint: t('upload.resumedHint'),
            state: 'bereit',
            uploadId: sitzung.id,
            gespeichert: false,
            uploadedBytes: sitzung.sizeBytes,
            transcodeProgress: sitzung.transcodeProgress,
            versionId: null,
          }));
        if (neue.length === 0) return;
        setJobs((current) => [...current, ...neue]);
        setOpen(true);
      } catch {
        // Gäste und Abgemeldete haben hier nichts – die Liste bleibt leer.
      }
    })();
  }, []);

  const cancel = useCallback(
    (id: string) => {
      const job = jobsRef.current.find((entry) => entry.id === id);
      if (!job) return;
      // Läuft noch: Der Abbruch am Handle reicht, der Rest kommt über den
      // Fehlerpfad zurück.
      if (job.state === 'lädt') {
        job.handle?.abort();
        return;
      }
      // Schon vollständig übertragen, aber noch nicht aufgenommen: Hier hilft
      // nur, die Sitzung serverseitig wegzuwerfen – sonst bliebe die Datei bis
      // zum Ablauf im Zwischenspeicher liegen.
      if (job.state === 'bereit' && job.uploadId) {
        void api.abortUpload(job.uploadId).catch(() => undefined);
        update(id, { state: 'abgebrochen', message: 'Verworfen.' });
      }
    },
    [update],
  );

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
      save,
      cancel,
      remove,
      clearFinished,
      setOpen,
      completedCount,
    }),
    [jobs, open, enqueue, update, start, save, cancel, remove, clearFinished, completedCount],
  );

  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

export function useUploads(): UploadsState {
  const context = useContext(UploadsContext);
  if (!context) throw new Error('useUploads muss innerhalb von <UploadsProvider> benutzt werden.');
  return context;
}

/**
 * Ein Fehler der Übertragung in der Sprache des Betrachters (Phase 26).
 *
 * Der Transportcode kennt keine Sprache und trägt deshalb Schlüssel mit sich;
 * erst hier, wo der Fehler in der Oberfläche landet, wird daraus ein Satz. Was
 * von woanders kommt – etwa eine Meldung der API – ist dort schon übersetzt
 * und geht unverändert durch.
 */
function uebersetzeFehler(error: unknown, t: Translator): string {
  if (error instanceof UploadTransportError) {
    return error.parts.map((teil) => t(teil.key, teil.vars)).join(' ');
  }
  return error instanceof Error ? error.message : t('upload.failed');
}
