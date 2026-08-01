'use client';

import type { ProjectDto, VideoDto } from '@klappe/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { NotificationPanel } from '@/components/NotificationPanel';
import { SharePanel } from '@/components/SharePanel';
import { ProjectFieldValues } from '@/components/ProjectFieldValues';
import { ProjectFiles } from '@/components/ProjectFiles';
import { ProjectTags } from '@/components/ProjectTags';
import { ShareManager } from '@/components/ShareManager';
import { Uploader } from '@/components/Uploader';
import { VersionStatusBadge } from '@/components/VersionStatusBadge';
import { IconButton } from '@/components/ui/Icon';
import { Menu, MenuItem } from '@/components/ui/Menu';
import {
  ArchiveProjectDialog,
  DeleteProjectDialog,
  EditProjectDialog,
} from '@/components/ProjectDialogs';
import { DeleteVideoDialog, EditVideoDialog } from '@/components/VideoDialogs';
import { api, mediaUrl } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useFallbackInterval, useLive } from '@/lib/live';
import { VIDEO_ACCEPT, hatZeiger, pickFiles } from '@/lib/pick-files';
import { useT } from '@/lib/i18n';
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
  const [archiving, setArchiving] = useState(false);
  const [editingVideo, setEditingVideo] = useState<VideoDto | null>(null);
  const [deletingVideo, setDeletingVideo] = useState<VideoDto | null>(null);
  // Reiter der rechten Spalte – wie am Video, nur ohne Kommentare (Phase 18).
  const [seitenTab, setSeitenTab] = useState<'freigaben' | 'benachrichtigungen'>('freigaben');
  const router = useRouter();
  const { user } = useSession();
  const { completedCount, enqueue } = useUploads();
  const t = useT();
  const { formatFrameRate, formatRelative } = useFormat();
  const isTeam = user?.role === 'ADMIN' || user?.role === 'MEMBER';
  /**
   * Team oder externer Projektadmin (Phase 21): darf Videos anlegen und
   * weiter freigeben – Projekt umbenennen/archivieren/löschen und einzelne
   * Videos umbenennen/löschen bleiben dem Team vorbehalten.
   */
  const canManage = isTeam || (project?.canManage ?? false);

  /** Ablagefläche sichtbar? Wird am Schreibtisch vom „+" auf- und zugeklappt. */
  const [uploaderOffen, setUploaderOffen] = useState(false);

  /**
   * Videodateien hinzufügen (Phase 24).
   *
   * Am Schreibtisch klappt das „+" die Ablagefläche auf – dorthin zieht man
   * Dateien direkt aus dem Finder, gerade mehrere auf einmal. Auf einem Gerät
   * ohne Zeiger gibt es nichts zu ziehen; dort öffnet es gleich die
   * Dateiauswahl. `videos` geht mit, damit das Upload-Fenster eine Datei als
   * neue Fassung eines vorhandenen Videos erkennen kann.
   */
  const videosHinzufuegen = useCallback(async () => {
    if (hatZeiger()) {
      setUploaderOffen((offen) => !offen);
      return;
    }
    const files = (await pickFiles({ accept: VIDEO_ACCEPT })).filter((file) => file.size > 0);
    if (files.length === 0) return;
    enqueue({ files, target: 'video', projectId, videos });
  }, [enqueue, projectId, videos]);

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
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
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

  // Live: Was an einem der Videos passiert, kommt von selbst an.
  const { subscribe } = useLive();
  useEffect(() => {
    const ids = new Set(videos.map((video) => video.id));
    return subscribe((event) => {
      if (event.projectId === projectId || (event.topic === 'video' && ids.has(event.id))) {
        void load();
      }
    });
  }, [subscribe, videos, projectId, load]);

  // Der alte Takt als Sicherheitsnetz (siehe `useFallbackInterval`).
  const pending = videos.some(
    (video) =>
      video.latestVersion?.status === 'PROCESSING' || video.latestVersion?.status === 'UPLOADING',
  );
  usePolling(load, useFallbackInterval(pending ? 3000 : null));

  return (
    <AppShell>
      <div className={isTeam ? 'review' : ''}>
      <div className="page">
        <div className="breadcrumb">
          <Link href="/projekte">{t('shell.projects')}</Link>
          <span>/</span>
          <span>{project?.name ?? '…'}</span>
        </div>

        <div className="page__header">
          <div>
            <h1 className="page__title">
              {project?.name ?? t('project.title')}
              {project?.archivedAt ? <span className="badge">{t('projects.archived')}</span> : null}
            </h1>
            {project?.description ? <p className="page__subtitle">{project.description}</p> : null}
          </div>
          <div className="shell__spacer" />
          {canManage ? (
            <>
              {/*
               * Videos hinzufügen: ein Symbol neben dem „…"-Menü (Phase 24).
               * Am Schreibtisch klappt es die Ablagefläche auf, ohne Zeiger
               * öffnet es direkt die Dateiauswahl – siehe `videosHinzufuegen`.
               * Vorher stand die Fläche dauerhaft mitten auf der Seite.
               */}
              <IconButton
                icon="plus"
                label={t('project.addVideos')}
                onClick={() => void videosHinzufuegen()}
              />

              {/* Wie am Video: Freigeben als eigenes Symbol neben dem „…"-Menü
                  (Phase 24) – der häufigste Handgriff verdient den direkten
                  Knopf, nicht erst den Umweg übers Menü. */}
              <IconButton
                icon="share"
                label={t('video.manageShares')}
                onClick={() => setSharing(true)}
              />

              {/* Umbenennen, Archivieren und Löschen bleiben dem Team
                  vorbehalten, auch für den externen Projektadmin (Phase 21). */}
              <Menu label={t('project.actions')}>
                <MenuItem onSelect={() => setSharing(true)}>{t('video.shareEllipsis')}</MenuItem>
                {isTeam ? (
                  <>
                    <MenuItem onSelect={() => setEditing(true)}>{t('projects.renameEllipsis')}</MenuItem>
                    <MenuItem onSelect={() => setArchiving(true)}>
                      {project?.archivedAt
                        ? t('project.unarchiveEllipsis')
                        : t('project.archiveEllipsis')}
                    </MenuItem>
                    <MenuItem danger onSelect={() => setDeleting(true)}>
                      {t('projects.deleteEllipsis')}
                    </MenuItem>
                  </>
                ) : null}
              </Menu>
            </>
          ) : null}
        </div>

        {error ? <div className="notice">{error}</div> : null}

        {isTeam && project ? (
          <ProjectTags projectId={projectId} assigned={project.tags} onChanged={load} />
        ) : null}

        {project ? <ProjectFieldValues project={project} isTeam={isTeam} onChanged={load} /> : null}

        {uploaderOffen && canManage ? (
          <div style={{ marginTop: 16 }}>
            <Uploader projectId={projectId} videos={videos} />
          </div>
        ) : null}

        <h2 style={{ fontSize: 16, margin: '26px 0 12px' }}>
          {t('project.videos')} {videos.length > 0 ? <span className="faint">({videos.length})</span> : null}
        </h2>

        {loading ? <p className="muted">{t('common.loading')}</p> : null}
        {!loading && videos.length === 0 ? (
          <div className="empty">{t('project.noVideos')}</div>
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
                    <span>{t('project.noPreview')}</span>
                  )}
                </div>
                <div className="tile__body">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span className="tile__title" style={{ flex: 1 }}>
                      {video.name}
                    </span>
                    {isTeam ? (
                      <Menu label={t('project.videoActions', { name: video.name })}>
                        <MenuItem onSelect={() => setEditingVideo(video)}>{t('projects.renameEllipsis')}</MenuItem>
                        <MenuItem danger onSelect={() => setDeletingVideo(video)}>
                          {t('projects.deleteEllipsis')}
                        </MenuItem>
                      </Menu>
                    ) : null}
                  </div>
                  <div className="tile__meta">
                    {version ? <VersionStatusBadge version={version} /> : <span className="badge">{t('project.empty')}</span>}
                    {version ? <span>v{version.versionNumber}</span> : null}
                    {version?.media.frameRate ? (
                      <span>{formatFrameRate(version.media.frameRate)}</span>
                    ) : null}
                    {version && version.commentCount > 0 ? (
                      <span>
                        {t('project.commentCount', { count: version.commentCount })}
                      </span>
                    ) : null}
                  </div>
                  <span className="faint" style={{ fontSize: 12 }}>
                    {t('project.changedAt', { when: formatRelative(video.updatedAt) })}
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

      {/* Die Freigaben stehen als Spalte rechts – wie am Video (Phase 16),
          seit Phase 18 mit den Benachrichtigungen daneben. */}
      {isTeam && project ? (
        <aside className="review__side">
          <div className="sidetabs">
            <button
              type="button"
              className="sidetabs__tab"
              data-active={seitenTab === 'freigaben'}
              onClick={() => setSeitenTab('freigaben')}
            >
              {t('video.tabShares')}
            </button>
            <button
              type="button"
              className="sidetabs__tab"
              data-active={seitenTab === 'benachrichtigungen'}
              onClick={() => setSeitenTab('benachrichtigungen')}
              title={t('project.notifyTitle')}
            >
              {t('video.tabNotifications')}
            </button>
          </div>

          {seitenTab === 'freigaben' ? (
            <SharePanel scope="PROJECT" projectId={projectId} targetLabel={project.name} />
          ) : (
            <NotificationPanel scope="PROJECT" projectId={projectId} />
          )}
        </aside>
      ) : null}

      </div>

      {sharing && project ? (
        <ShareManager
          scope="PROJECT"
          projectId={projectId}
          targetLabel={project.name}
          onClose={() => setSharing(false)}
          canManage={isTeam}
        />
      ) : null}

      {archiving && project ? (
        <ArchiveProjectDialog
          project={project}
          onClose={() => setArchiving(false)}
          onDone={async () => {
            setArchiving(false);
            await load();
          }}
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
