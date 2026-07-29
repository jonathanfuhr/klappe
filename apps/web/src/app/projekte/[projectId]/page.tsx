'use client';

import type { ProjectDto, VideoDto } from '@klappe/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { SharePanel } from '@/components/SharePanel';
import { ProjectFieldValues } from '@/components/ProjectFieldValues';
import { ProjectFiles } from '@/components/ProjectFiles';
import { ProjectTags } from '@/components/ProjectTags';
import { ShareManager } from '@/components/ShareManager';
import { Uploader } from '@/components/Uploader';
import { VersionStatusBadge } from '@/components/VersionStatusBadge';
import { Menu, MenuItem } from '@/components/ui/Menu';
import { DeleteProjectDialog, EditProjectDialog } from '@/components/ProjectDialogs';
import { DeleteVideoDialog, EditVideoDialog } from '@/components/VideoDialogs';
import { api, mediaUrl } from '@/lib/api';
import { formatFrameRate, formatRelative } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useUploads } from '@/lib/uploads-context';

export default function ProjectPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [project, setProject] = useState<ProjectDto | null>(null);
  const [videos, setVideos] = useState<VideoDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingVideo, setEditingVideo] = useState<VideoDto | null>(null);
  const [deletingVideo, setDeletingVideo] = useState<VideoDto | null>(null);
  const router = useRouter();
  const { user } = useSession();
  const { completedCount } = useUploads();
  const isTeam = user?.role === 'ADMIN' || user?.role === 'MEMBER';

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

  // Nach jedem abgeschlossenen Upload die Liste auffrischen.
  useEffect(() => {
    if (completedCount > 0) void load();
  }, [completedCount, load]);

  // Solange etwas transcodiert wird, den Stand regelmäßig nachladen.
  const pending = videos.some(
    (video) =>
      video.latestVersion?.status === 'PROCESSING' || video.latestVersion?.status === 'UPLOADING',
  );
  usePolling(load, pending ? 3000 : null);

  return (
    <AppShell>
      <div className={isTeam ? 'review' : ''}>
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
          <div className="shell__spacer" />
          {isTeam ? (
            <>
              {/* Der große „Freigeben"-Knopf ist in die Spalte rechts gewandert
                  (Phase 16) – dort steht er neben denen, die es betrifft. */}
              <Menu label="Aktionen für dieses Projekt">
                <MenuItem onSelect={() => setSharing(true)}>Freigeben …</MenuItem>
                <MenuItem onSelect={() => setEditing(true)}>Umbenennen …</MenuItem>
                <MenuItem danger onSelect={() => setDeleting(true)}>
                  Löschen …
                </MenuItem>
              </Menu>
            </>
          ) : null}
        </div>

        {error ? <div className="notice">{error}</div> : null}

        {isTeam && project ? (
          <ProjectTags projectId={projectId} assigned={project.tags} onChanged={load} />
        ) : null}

        {project ? <ProjectFieldValues project={project} isTeam={isTeam} onChanged={load} /> : null}

        {isTeam ? <Uploader projectId={projectId} videos={videos} /> : null}

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
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span className="tile__title" style={{ flex: 1 }}>
                      {video.name}
                    </span>
                    {isTeam ? (
                      <Menu label={`Aktionen für ${video.name}`}>
                        <MenuItem onSelect={() => setEditingVideo(video)}>Umbenennen …</MenuItem>
                        <MenuItem danger onSelect={() => setDeletingVideo(video)}>
                          Löschen …
                        </MenuItem>
                      </Menu>
                    ) : null}
                  </div>
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

        {project && (isTeam || project.canUploadFiles || project.fileCount > 0) ? (
          <ProjectFiles
            projectId={projectId}
            canUpload={project.canUploadFiles}
            currentUser={user}
            reloadToken={completedCount}
          />
        ) : null}

      </div>

      {/* Die Freigaben stehen als Spalte rechts – wie am Video (Phase 16). */}
      {isTeam && project ? (
        <aside className="review__side">
          <SharePanel scope="PROJECT" projectId={projectId} targetLabel={project.name} />
        </aside>
      ) : null}

      </div>

      {sharing && project ? (
        <ShareManager
          scope="PROJECT"
          projectId={projectId}
          targetLabel={project.name}
          onClose={() => setSharing(false)}
        />
      ) : null}

      {editing && project ? (
        <EditProjectDialog
          project={project}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await load();
          }}
        />
      ) : null}

      {deleting && project ? (
        <DeleteProjectDialog
          project={project}
          onClose={() => setDeleting(false)}
          onDeleted={async () => {
            // Die Seite, auf der wir stehen, gibt es nicht mehr.
            router.replace('/projekte');
          }}
        />
      ) : null}

      {editingVideo ? (
        <EditVideoDialog
          video={editingVideo}
          onClose={() => setEditingVideo(null)}
          onSaved={async () => {
            setEditingVideo(null);
            await load();
          }}
        />
      ) : null}

      {deletingVideo ? (
        <DeleteVideoDialog
          video={deletingVideo}
          onClose={() => setDeletingVideo(null)}
          onDeleted={async () => {
            setDeletingVideo(null);
            await load();
          }}
        />
      ) : null}
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
