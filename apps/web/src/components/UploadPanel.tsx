'use client';

import type { ProjectDto, VideoDto } from '@klappe/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { useSession } from '@/lib/session';
import { type UploadJob, useUploads } from '@/lib/uploads-context';

/**
 * Das Upload-Fenster (Notion-Nachtrag).
 *
 * Es hängt am Rand der Anwendung, lässt sich einklappen und wieder öffnen und
 * überlebt den Wechsel zwischen Projekten – die Warteschlange liegt im
 * `UploadsProvider` im Wurzel-Layout, nicht in dieser Ansicht.
 *
 * Pro Datei stehen hier Projekt, Video und Datum zur Wahl; die Vorauswahl
 * kommt aus dem Dateinamen und ist als Vorschlag gekennzeichnet.
 */
export function UploadPanel() {
  const { jobs, open, setOpen, update, start, cancel, remove, clearFinished } = useUploads();
  const { user } = useSession();
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [videosByProject, setVideosByProject] = useState<Record<string, VideoDto[]>>({});

  const isTeam = user?.role === 'ADMIN' || user?.role === 'MEMBER';
  const pending = jobs.filter((job) => job.state === 'wartet');
  const active = jobs.filter((job) => job.state === 'lädt' || job.state === 'verarbeitet');

  useEffect(() => {
    if (jobs.length === 0 || !isTeam) return;
    api
      .listProjects()
      .then(setProjects)
      .catch(() => undefined);
  }, [jobs.length, isTeam]);

  /** Videos eines Projekts nachladen, sobald es in der Liste auftaucht. */
  useEffect(() => {
    const needed = [...new Set(jobs.map((job) => job.projectId))].filter(
      (projectId) => projectId && !(projectId in videosByProject),
    );
    if (needed.length === 0) return;

    for (const projectId of needed) {
      api
        .listVideos(projectId)
        .then((videos) => setVideosByProject((current) => ({ ...current, [projectId]: videos })))
        .catch(() => setVideosByProject((current) => ({ ...current, [projectId]: [] })));
    }
  }, [jobs, videosByProject]);

  /** Fortschritt des Transcodings nachfragen, solange etwas verarbeitet wird. */
  const refreshTranscode = useCallback(async () => {
    for (const job of jobs) {
      if (job.state !== 'verarbeitet' || !job.versionId) continue;
      try {
        const version = await api.getVersion(job.versionId);
        if (version.status === 'READY') {
          update(job.id, { state: 'fertig', transcodeProgress: 100 });
        } else if (version.status === 'FAILED') {
          update(job.id, {
            state: 'fehler',
            message: version.processingError ?? 'Verarbeitung fehlgeschlagen.',
          });
        } else {
          update(job.id, { transcodeProgress: version.progress });
        }
      } catch {
        // Ein vorübergehender Fehler beim Nachfragen ist kein Grund,
        // den Upload als gescheitert zu markieren.
      }
    }
  }, [jobs, update]);

  useEffect(() => {
    if (!jobs.some((job) => job.state === 'verarbeitet')) return;
    const timer = setInterval(() => void refreshTranscode(), 2500);
    return () => clearInterval(timer);
  }, [jobs, refreshTranscode]);

  const summary = useMemo(() => {
    if (active.length > 0) return `${active.length} laufend`;
    if (pending.length > 0) return `${pending.length} wartet`;
    const failed = jobs.filter((job) => job.state === 'fehler').length;
    if (failed > 0) return `${failed} fehlgeschlagen`;
    return `${jobs.length} fertig`;
  }, [active.length, pending.length, jobs]);

  if (jobs.length === 0) return null;

  return (
    <div className="uploadpanel" data-open={open}>
      <button type="button" className="uploadpanel__bar" onClick={() => setOpen(!open)}>
        <span className="uploadpanel__title">Uploads</span>
        <span className="badge">{summary}</span>
        <span className="shell__spacer" />
        <span aria-hidden>{open ? '▾' : '▴'}</span>
      </button>

      {open ? (
        <div className="uploadpanel__body">
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              projects={projects}
              videos={videosByProject[job.projectId] ?? []}
              editable={job.state === 'wartet' && isTeam}
              onChange={(changes) => update(job.id, changes)}
              onCancel={() => cancel(job.id)}
              onRemove={() => remove(job.id)}
            />
          ))}

          <div className="uploadpanel__actions">
            <button type="button" className="button button--ghost" onClick={clearFinished}>
              Erledigte ausblenden
            </button>
            <div className="shell__spacer" />
            {pending.length > 0 ? (
              <button
                type="button"
                className="button button--primary"
                onClick={start}
                disabled={pending.some((job) => !job.projectId)}
              >
                {pending.length === 1 ? 'Upload starten' : `${pending.length} Uploads starten`}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function JobRow({
  job,
  projects,
  videos,
  editable,
  onChange,
  onCancel,
  onRemove,
}: {
  job: UploadJob;
  projects: ProjectDto[];
  videos: VideoDto[];
  editable: boolean;
  onChange: (changes: Partial<UploadJob>) => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const uploadFraction = job.file.size > 0 ? job.uploadedBytes / job.file.size : 0;
  const isVideo = job.target === 'video';

  // Die Fassungsnummer vergibt der Server fortlaufend – sie lässt sich nicht
  // frei wählen, ohne Lücken zu reißen. Angezeigt wird sie trotzdem, und wenn
  // der Dateiname etwas anderes sagt, wird darauf hingewiesen.
  const selectedVideo = videos.find((video) => video.id === job.videoId) ?? null;
  const nextVersion = selectedVideo ? selectedVideo.versionCount + 1 : 1;
  const versionMismatch = job.detectedVersion !== null && job.detectedVersion !== nextVersion;

  return (
    <div className="uploadjob" data-state={job.state}>
      <div className="toolbar">
        <span className="uploadjob__name" title={job.file.name}>
          {job.file.name}
        </span>
        <span className="shell__spacer" />
        <span className="muted mono" style={{ fontSize: 12 }}>
          {formatBytes(job.uploadedBytes)} / {formatBytes(job.file.size)}
        </span>
        <StateBadge job={job} />
        {job.state === 'lädt' ? (
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Abbrechen
          </button>
        ) : null}
        {job.state === 'wartet' || job.state === 'fehler' || job.state === 'abgebrochen' ? (
          <button type="button" className="button button--ghost" onClick={onRemove}>
            Entfernen
          </button>
        ) : null}
      </div>

      {editable && isVideo ? (
        <div className="uploadjob__fields">
          <label className="field" style={{ margin: 0 }}>
            <span className="field__label">Projekt</span>
            <select
              className="select"
              value={job.projectId}
              onChange={(event) => onChange({ projectId: event.target.value, videoId: '' })}
            >
              <option value="">Bitte wählen …</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.customer ? `${project.customer} · ` : ''}
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field" style={{ margin: 0 }}>
            <span className="field__label">Video</span>
            <select
              className="select"
              value={job.videoId}
              onChange={(event) => onChange({ videoId: event.target.value })}
            >
              <option value="">Neues Video anlegen</option>
              {videos.map((video) => (
                <option key={video.id} value={video.id}>
                  {video.name} (nächste Fassung: v{video.versionCount + 1})
                </option>
              ))}
            </select>
          </label>

          {job.videoId ? null : (
            <label className="field" style={{ margin: 0 }}>
              <span className="field__label">Name des neuen Videos</span>
              <input
                className="input"
                value={job.newVideoName}
                onChange={(event) => onChange({ newVideoName: event.target.value })}
              />
            </label>
          )}

          <label className="field" style={{ margin: 0 }}>
            <span className="field__label">Fassung</span>
            <input className="input" value={`v${nextVersion}`} readOnly data-version={nextVersion} />
            {versionMismatch ? (
              <p className="hint">
                Im Dateinamen steht v{job.detectedVersion} – hochgeladen wird v{nextVersion}.
              </p>
            ) : null}
          </label>

          <label className="field" style={{ margin: 0 }}>
            <span className="field__label">Datum im Dateinamen</span>
            <input
              className="input"
              type="date"
              value={job.fileDate}
              onChange={(event) => onChange({ fileDate: event.target.value })}
            />
          </label>
        </div>
      ) : null}

      {editable && job.hint ? <div className="uploadjob__hint">⚠ {job.hint}</div> : null}

      {job.state === 'lädt' || job.state === 'fertig' || job.state === 'verarbeitet' ? (
        <>
          <div className="progress" style={{ marginTop: 6 }}>
            <div className="progress__bar" style={{ width: `${uploadFraction * 100}%` }} />
          </div>
          {isVideo && job.state !== 'lädt' ? (
            <div className="uploadjob__transcode">
              <span className="faint" style={{ fontSize: 12 }}>
                Verarbeitung
              </span>
              <div className="progress" style={{ flex: 1 }}>
                <div
                  className="progress__bar"
                  style={{
                    width: `${job.state === 'fertig' ? 100 : job.transcodeProgress}%`,
                    background: 'var(--klappe-success)',
                  }}
                />
              </div>
              <span className="faint mono" style={{ fontSize: 12 }}>
                {job.state === 'fertig' ? 100 : job.transcodeProgress} %
              </span>
            </div>
          ) : null}
        </>
      ) : null}

      {job.message ? <div className="uploadjob__hint">{job.message}</div> : null}
    </div>
  );
}

function StateBadge({ job }: { job: UploadJob }) {
  switch (job.state) {
    case 'fertig':
      return <span className="badge badge--ready">Fertig</span>;
    case 'fehler':
      return <span className="badge badge--failed">Fehler</span>;
    case 'verarbeitet':
      return <span className="badge badge--processing">Verarbeitung</span>;
    case 'lädt':
      return <span className="badge">Lädt</span>;
    case 'abgebrochen':
      return <span className="badge">Abgebrochen</span>;
    default:
      return <span className="badge">Wartet</span>;
  }
}
