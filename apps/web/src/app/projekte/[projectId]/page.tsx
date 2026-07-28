'use client';

import type { ProjectDto, VideoDto } from '@klappe/shared';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Uploader } from '@/components/Uploader';
import { VersionStatusBadge } from '@/components/VersionStatusBadge';
import { api, mediaUrl } from '@/lib/api';
import { formatFrameRate, formatRelative } from '@/lib/format';

export default function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [project, setProject] = useState<ProjectDto | null>(null);
  const [videos, setVideos] = useState<VideoDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [projectData, videoData] = await Promise.all([
        api.getProject(projectId),
        api.listVideos(projectId),
      ]);
      setProject(projectData);
      setVideos(videoData);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Solange etwas transcodiert wird, den Stand regelmäßig nachladen.
  const pending = videos.some(
    (video) =>
      video.latestVersion?.status === 'PROCESSING' || video.latestVersion?.status === 'UPLOADING',
  );
  usePolling(load, pending ? 3000 : null);

  return (
    <AppShell>
      <div className="page">
        <div className="breadcrumb">
          <Link href="/projekte">Projekte</Link>
          <span>/</span>
          <span>{project?.name ?? '…'}</span>
        </div>

        <div className="page__header">
          <div>
            <h1 className="page__title">{project?.name ?? 'Projekt'}</h1>
            {project?.description ? <p className="page__subtitle">{project.description}</p> : null}
          </div>
        </div>

        {error ? <div className="notice">{error}</div> : null}

        <Uploader projectId={projectId} onDone={load} />

        <h2 style={{ fontSize: 16, margin: '26px 0 12px' }}>
          Videos {videos.length > 0 ? <span className="faint">({videos.length})</span> : null}
        </h2>

        {loading ? <p className="muted">Wird geladen …</p> : null}
        {!loading && videos.length === 0 ? (
          <div className="empty">Noch keine Videos in diesem Projekt.</div>
        ) : null}

        <div className="grid">
          {videos.map((video) => {
            const version = video.latestVersion;
            return (
              <Link key={video.id} href={`/videos/${video.id}`} className="card tile">
                <div className="tile__thumb">
                  {version?.hasPoster ? (
                    // Bewusst kein next/image: Die Datei liegt hinter der
                    // API-Authentifizierung und wird nicht optimiert.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaUrl.poster(version.id)} alt="" loading="lazy" />
                  ) : (
                    <span>Keine Vorschau</span>
                  )}
                </div>
                <div className="tile__body">
                  <span className="tile__title">{video.name}</span>
                  <div className="tile__meta">
                    {version ? <VersionStatusBadge version={version} /> : <span className="badge">leer</span>}
                    {version ? <span>v{version.versionNumber}</span> : null}
                    {version?.media.frameRate ? (
                      <span>{formatFrameRate(version.media.frameRate)}</span>
                    ) : null}
                    {version && version.commentCount > 0 ? (
                      <span>
                        {version.commentCount} {version.commentCount === 1 ? 'Kommentar' : 'Kommentare'}
                      </span>
                    ) : null}
                  </div>
                  <span className="faint" style={{ fontSize: 12 }}>
                    Geändert {formatRelative(video.updatedAt)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}

/** Ruft `callback` im Takt auf; `intervalMs === null` schaltet ab. */
function usePolling(callback: () => void | Promise<void>, intervalMs: number | null): void {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (intervalMs === null) return;
    const timer = setInterval(() => void saved.current(), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
}
