'use client';

import {
  type Annotation,
  type CommentDto,
  type VersionDto,
  type VideoDto,
  frameToDisplayTimecode,
  versionLabel,
} from '@klappe/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ShareManager } from '@/components/ShareManager';
import { Uploader } from '@/components/Uploader';
import { VersionStatusBadge } from '@/components/VersionStatusBadge';
import { CommentPanel } from '@/components/comments/CommentPanel';
import { type CommentMarker, type PlayerHandle, VideoPlayer } from '@/components/player/VideoPlayer';
import { Dialog } from '@/components/ui/Dialog';
import { Menu, MenuItem } from '@/components/ui/Menu';
import { IconButton } from '@/components/ui/Icon';
import { SharePanel } from '@/components/SharePanel';
import { DeleteVideoDialog, EditVideoDialog } from '@/components/VideoDialogs';
import { api, mediaUrl } from '@/lib/api';
import { formatBytes, formatFrameRate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useUploads } from '@/lib/uploads-context';

export default function ReviewPage() {
  const params = useParams<{ videoId: string }>();
  const videoId = params.videoId;
  const { user } = useSession();
  const { completedCount } = useUploads();

  const playerRef = useRef<PlayerHandle>(null);

  const [video, setVideo] = useState<VideoDto | null>(null);
  const [versions, setVersions] = useState<VersionDto[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [comments, setComments] = useState<CommentDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentFrame, setCurrentFrame] = useState(0);
  /** Beim Kommentieren festgehaltener Frame, damit er nicht weiterläuft. */
  const [draftFrame, setDraftFrame] = useState<number | null>(null);
  const [pinned, setPinned] = useState(true);
  const [focusToken, setFocusToken] = useState(0);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [showUploader, setShowUploader] = useState(false);
  const [sharing, setSharing] = useState(false);
  /** Nachfrage vor dem Löschen – eine Fassung ist samt Kommentaren weg. */
  const [versionToDelete, setVersionToDelete] = useState<VersionDto | null>(null);
  const [draftAnnotation, setDraftAnnotation] = useState<Annotation | null>(null);

  const isTeam = user?.role === 'ADMIN' || user?.role === 'MEMBER';
  const router = useRouter();
  const [seitenTab, setSeitenTab] = useState<'kommentare' | 'freigaben'>('kommentare');
  const [editingVideo, setEditingVideo] = useState(false);
  const [deletingVideo, setDeletingVideo] = useState(false);

  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) ?? null,
    [versions, selectedVersionId],
  );

  const loadVideo = useCallback(async () => {
    try {
      const [videoData, versionData] = await Promise.all([
        api.getVideo(videoId),
        api.listVersions(videoId),
      ]);
      setVideo(videoData);
      setVersions(versionData);
      setSelectedVersionId((current) => current ?? versionData[0]?.id ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Laden fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  const loadComments = useCallback(async () => {
    if (!selectedVersionId) {
      setComments([]);
      return;
    }
    try {
      setComments(await api.listComments(selectedVersionId));
    } catch {
      setComments([]);
    }
  }, [selectedVersionId]);

  useEffect(() => {
    void loadVideo();
  }, [loadVideo]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  // Nach einem abgeschlossenen Upload die Fassungen auffrischen.
  useEffect(() => {
    if (completedCount > 0) void loadVideo();
  }, [completedCount, loadVideo]);

  // Während der Verarbeitung den Fortschritt nachladen.
  const processing =
    selectedVersion?.status === 'PROCESSING' || selectedVersion?.status === 'UPLOADING';
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => void loadVideo(), 3000);
    return () => clearInterval(timer);
  }, [processing, loadVideo]);

  const timecodeContext = useMemo(
    () => ({
      fps: selectedVersion?.media.frameRate ?? { num: 25, den: 1 },
      dropFrame: selectedVersion?.media.dropFrame ?? false,
      startFrames: selectedVersion?.media.startTimecodeFrames ?? 0,
    }),
    [selectedVersion],
  );

  const composerFrame = draftFrame ?? currentFrame;
  const composerTimecode = selectedVersion?.media.frameRate
    ? frameToDisplayTimecode(composerFrame, timecodeContext)
    : null;

  const markers: CommentMarker[] = useMemo(
    () =>
      comments
        .filter((comment): comment is CommentDto & { frame: number } => comment.frame !== null)
        .map((comment) => ({
          id: comment.id,
          frame: comment.frame,
          resolved: Boolean(comment.resolvedAt),
          label: `${comment.author.name}: ${comment.body.slice(0, 60)}`,
        })),
    [comments],
  );

  /**
   * Die Zeichnung eines Kommentars wird eingeblendet, solange der Abspielkopf
   * auf seinem Frame steht – so wie sie gemeint war.
   */
  const shownAnnotation = useMemo(() => {
    const active = comments.find((comment) => comment.id === activeCommentId);
    if (active?.annotation && active.frame === currentFrame) return active.annotation;
    const atFrame = comments.find(
      (comment) => comment.frame === currentFrame && comment.annotation,
    );
    return atFrame?.annotation ?? null;
  }, [comments, activeCommentId, currentFrame]);

  /** Gäste ohne Kommentarrecht sehen nur zu; die API entscheidet das. */
  const canComment = video?.canComment ?? false;

  const selectComment = useCallback((comment: CommentDto) => {
    setActiveCommentId(comment.id);
    if (comment.frame !== null) {
      playerRef.current?.seekToFrame(comment.frame);
    }
  }, []);

  const createComment = useCallback(
    async (body: string, options: { frame: number | null; parentId?: string }) => {
      if (!selectedVersionId) return;
      await api.createComment(selectedVersionId, {
        body,
        frame: options.frame,
        parentId: options.parentId,
        // Eine Skizze gehört zum Frame; bei einer Antwort ohne Frame entfällt sie.
        annotation: options.parentId || options.frame === null ? null : draftAnnotation,
      });
      setDraftFrame(null);
      setDraftAnnotation(null);
      playerRef.current?.clearDrawing();
      await loadComments();
      await loadVideo();
    },
    [selectedVersionId, draftAnnotation, loadComments, loadVideo],
  );

  return (
    <AppShell>
      <div className="review">
        <div className="review__main">
          <div className="breadcrumb">
            <Link href="/projekte">Projekte</Link>
            <span>/</span>
            {video ? (
              <Link href={`/projekte/${video.projectId}`}>
                {video.projectCustomer ? `${video.projectCustomer} · ` : ''}
                {video.projectName ?? 'Projekt'}
              </Link>
            ) : (
              <span>…</span>
            )}
            <span>/</span>
            <span>{video?.name ?? '…'}</span>
          </div>

          <div className="toolbar">
            <h1 className="page__title" style={{ fontSize: 19 }}>
              {video?.name ?? 'Video'}
            </h1>
            {selectedVersion ? <VersionStatusBadge version={selectedVersion} /> : null}

            <div className="shell__spacer" />

            {versions.length > 0 ? (
              <select
                className="select"
                style={{ width: 'auto' }}
                value={selectedVersionId ?? ''}
                onChange={(event) => {
                  setSelectedVersionId(event.target.value);
                  setActiveCommentId(null);
                  setDraftFrame(null);
                }}
                aria-label="Version"
              >
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {versionLabel(version.versionNumber)}
                    {version.label ? ` – ${version.label}` : ''} ({version.commentCount} Komm.)
                  </option>
                ))}
              </select>
            ) : null}

            {/* Symbole statt Textknöpfe – die Leiste war voll (Phase 16).
                Was seltener gebraucht wird, steht im „…"-Menü daneben; wer
                Zugriffe sehen will, nimmt den Reiter „Freigaben" rechts. */}
            {isTeam ? (
              <>
                <IconButton
                  icon="plus"
                  label="Neue Version hochladen"
                  onClick={() => setShowUploader((show) => !show)}
                />
                <IconButton
                  icon="share"
                  label="Freigabe-Links verwalten"
                  onClick={() => setSharing(true)}
                />
              </>
            ) : null}

            {selectedVersion?.status === 'READY' && selectedVersion.canDownload ? (
              <IconButton
                icon="download"
                label="Original herunterladen (nie der Proxy)"
                href={mediaUrl.original(selectedVersion.id)}
                download
              />
            ) : null}

            {isTeam ? (
              <Menu label="Aktionen für dieses Video">
                <MenuItem onSelect={() => setShowUploader((show) => !show)}>
                  Neue Version …
                </MenuItem>
                <MenuItem onSelect={() => setSharing(true)}>Freigeben …</MenuItem>
                <MenuItem onSelect={() => setEditingVideo(true)}>Video umbenennen …</MenuItem>
                {selectedVersion ? (
                  <MenuItem danger onSelect={() => setVersionToDelete(selectedVersion)}>
                    Fassung löschen …
                  </MenuItem>
                ) : null}
                <MenuItem danger onSelect={() => setDeletingVideo(true)}>
                  Video löschen …
                </MenuItem>
              </Menu>
            ) : null}
          </div>

          {isTeam && video && selectedVersion ? (
            <div className="toolbar card" style={{ padding: '8px 14px' }}>
              <span className="muted" style={{ fontSize: 13 }}>
                Download für Gäste:
              </span>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={video.downloadsEnabled}
                  onChange={(event) => {
                    void api
                      .updateVideo(video.id, { downloadsEnabled: event.target.checked })
                      .then(loadVideo);
                  }}
                />
                ganzes Video
              </label>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={selectedVersion.downloadEnabled}
                  onChange={(event) => {
                    void api
                      .updateVersion(selectedVersion.id, { downloadEnabled: event.target.checked })
                      .then(loadVideo);
                  }}
                />
                {versionLabel(selectedVersion.versionNumber)}
              </label>
              <span className="hint" style={{ marginTop: 0 }}>
                Wirkt nur zusammen mit dem Download-Recht am Freigabe-Link.
              </span>
            </div>
          ) : null}

          {error ? <div className="notice">{error}</div> : null}
          {loading ? <p className="muted">Wird geladen …</p> : null}

          {showUploader && video && isTeam ? (
            <Uploader projectId={video.projectId} videoId={video.id} />
          ) : null}

          {selectedVersion ? (
            <>
              <VideoPlayer
                ref={playerRef}
                version={selectedVersion}
                markers={markers}
                activeCommentId={activeCommentId}
                shownAnnotation={shownAnnotation}
                canComment={canComment}
                onDraftAnnotationChange={setDraftAnnotation}
                onFrameChange={setCurrentFrame}
                onMarkerClick={(commentId) => {
                  const comment = comments.find((entry) => entry.id === commentId);
                  if (comment) selectComment(comment);
                }}
                onRequestComment={(frame) => {
                  setDraftFrame(frame);
                  setPinned(true);
                  setFocusToken((token) => token + 1);
                }}
              />

              <VersionDetails version={selectedVersion} />
              <ShortcutHelp />
            </>
          ) : (
            !loading && (
              <div className="empty">
                Für dieses Video wurde noch keine Datei hochgeladen.
                <div style={{ marginTop: 12 }}>
                  {video ? <Uploader projectId={video.projectId} videoId={video.id} /> : null}
                </div>
              </div>
            )
          )}
        </div>

        <aside className="review__side">
          {isTeam ? (
            <div className="sidetabs">
              <button
                type="button"
                className="sidetabs__tab"
                data-active={seitenTab === 'kommentare'}
                onClick={() => setSeitenTab('kommentare')}
              >
                Kommentare
              </button>
              <button
                type="button"
                className="sidetabs__tab"
                data-active={seitenTab === 'freigaben'}
                onClick={() => setSeitenTab('freigaben')}
              >
                Freigaben
              </button>
            </div>
          ) : null}

          {isTeam && seitenTab === 'freigaben' && video ? (
            <SharePanel
              scope="VIDEO"
              projectId={video.projectId}
              videoId={video.id}
              targetLabel={video.name}
            />
          ) : (
          <CommentPanel
            comments={comments}
            currentUser={user}
            activeCommentId={activeCommentId}
            composerFrame={composerFrame}
            composerTimecode={composerTimecode}
            pinned={pinned}
            onPinnedChange={setPinned}
            focusToken={focusToken}
            onSelect={selectComment}
            onChanged={async () => {
              await loadComments();
            }}
            onCreate={createComment}
            draftAnnotation={draftAnnotation}
            onClearDraftAnnotation={() => {
              setDraftAnnotation(null);
              playerRef.current?.clearDrawing();
            }}
            canComment={canComment}
          />
          )}
        </aside>
      </div>

      {sharing && video ? (
        <ShareManager
          scope="VIDEO"
          videoId={video.id}
          targetLabel={video.name}
          onClose={() => setSharing(false)}
        />
      ) : null}


      {versionToDelete ? (
        <Dialog
          title={`${versionLabel(versionToDelete.versionNumber)} löschen?`}
          onClose={() => setVersionToDelete(null)}
        >
          <p style={{ marginTop: 0 }}>
            Das Original, die Abspielfassung und alle {versionToDelete.commentCount} Kommentare
            dieser Fassung werden entfernt. Andere Fassungen des Videos bleiben unberührt.
          </p>
          <p className="muted" style={{ fontSize: 13 }}>
            {versionToDelete.originalFilename}
          </p>
          <div className="dialog__actions">
            <button type="button" className="button" onClick={() => setVersionToDelete(null)}>
              Abbrechen
            </button>
            <button
              type="button"
              className="button button--danger"
              onClick={async () => {
                const entfernt = versionToDelete;
                setVersionToDelete(null);
                try {
                  await api.deleteVersion(entfernt.id);
                  // Auf eine andere Fassung springen, sonst zeigt der Player ins Leere.
                  setSelectedVersionId(
                    versions.find((eintrag) => eintrag.id !== entfernt.id)?.id ?? null,
                  );
                  setActiveCommentId(null);
                  await loadVideo();
                } catch (deleteError) {
                  setError(
                    deleteError instanceof Error ? deleteError.message : 'Löschen fehlgeschlagen.',
                  );
                }
              }}
            >
              Endgültig löschen
            </button>
          </div>
        </Dialog>
      ) : null}

      {editingVideo && video ? (
        <EditVideoDialog
          video={video}
          onClose={() => setEditingVideo(false)}
          onSaved={async () => {
            setEditingVideo(false);
            await loadVideo();
          }}
        />
      ) : null}

      {deletingVideo && video ? (
        <DeleteVideoDialog
          video={video}
          onClose={() => setDeletingVideo(false)}
          onDeleted={async () => {
            // Die Seite, auf der wir stehen, gibt es nicht mehr.
            router.replace(`/projekte/${video.projectId}`);
          }}
        />
      ) : null}
    </AppShell>
  );
}

function VersionDetails({ version }: { version: VersionDto }) {
  const media = version.media;
  const entries: Array<[string, string]> = [
    ['Datei', version.originalFilename],
    ['Größe', formatBytes(version.originalSizeBytes)],
    ['Auflösung', media.width && media.height ? `${media.width} × ${media.height}` : '–'],
    ['Framerate', formatFrameRate(media.frameRate)],
    ['Zählweise', media.frameRate ? (media.dropFrame ? 'Drop-Frame' : 'Non-Drop') : '–'],
    ['Start-Timecode', media.startTimecode ?? '–'],
    ['Frames', media.frameCount ? String(media.frameCount) : '–'],
    ['Codec', media.videoCodec ?? '–'],
    ['Hochgeladen von', version.uploadedBy?.name ?? '–'],
  ];

  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div className="shortcuts">
        {entries.map(([label, value]) => (
          <div key={label}>
            <span className="faint">{label}: </span>
            <span className={label === 'Start-Timecode' ? 'mono' : undefined}>{value}</span>
          </div>
        ))}
      </div>
      {version.processingError ? (
        <div className="notice" style={{ marginTop: 10 }}>
          {version.processingError}
        </div>
      ) : null}
    </div>
  );
}

function ShortcutHelp() {
  const shortcuts: Array<[string, string]> = [
    ['Leer', 'Abspielen / Pause'],
    ['J / K / L', 'Rückwärts / Stopp / Vorwärts'],
    ['← →', 'Ein Bild zurück / vor'],
    ['⇧ + ← →', 'Eine Sekunde'],
    ['Pos1 / Ende', 'Anfang / Ende'],
    ['C', 'Kommentar am Bild'],
    ['M', 'Ton stumm'],
    ['F', 'Vollbild'],
  ];

  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div className="shortcuts">
        {shortcuts.map(([key, description]) => (
          <div key={key}>
            <span className="shortcuts__key">{key}</span>
            {description}
          </div>
        ))}
      </div>
    </div>
  );
}
