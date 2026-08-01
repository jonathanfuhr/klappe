'use client';

import {
  type AiContentSettingsDto,
  type Annotation,
  type CommentDto,
  type VersionDownloadsDto,
  type VersionDto,
  type VideoDto,
  VERSION_NUMBER_MAX,
  VERSION_QUERY_PARAM,
  checkVersionRenumber,
  formatVersionNumber,
  frameToDisplayTimecode,
  versionLabel,
} from '@klappe/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { NotificationPanel } from '@/components/NotificationPanel';
import { ShareManager } from '@/components/ShareManager';
import { Uploader } from '@/components/Uploader';
import { VersionChips } from '@/components/VersionChips';
import { VersionStatusBadge } from '@/components/VersionStatusBadge';
import { CommentPanel } from '@/components/comments/CommentPanel';
import { type CommentMarker, type PlayerHandle, VideoPlayer } from '@/components/player/VideoPlayer';
import { Dialog } from '@/components/ui/Dialog';
import { Menu, MenuItem } from '@/components/ui/Menu';
import { IconButton } from '@/components/ui/Icon';
import { SharePanel } from '@/components/SharePanel';
import { DeleteVideoDialog, EditVideoDialog } from '@/components/VideoDialogs';
import { DownloadDialog } from '@/components/DownloadDialog';
import { EmbedDialog } from '@/components/EmbedDialog';
import { api, mediaUrl } from '@/lib/api';
import { useFormat } from '@/lib/format';
import { useFallbackInterval, useLiveTopic } from '@/lib/live';
import { VIDEO_ACCEPT, hatZeiger, pickFiles } from '@/lib/pick-files';
import { useAiKindName } from '@/lib/ai-kinds';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useUploads } from '@/lib/uploads-context';
import { useUserName } from '@/lib/user-name';

/**
 * Die Fassung aus `?fassung=` – als formatierte Nummer, so wie sie auch in
 * der Adresse steht. `null`, wenn nichts (Brauchbares) dransteht.
 *
 * Bewusst nicht über `useSearchParams`: Next verlangt dafür eine
 * `Suspense`-Grenze um die ganze Seite, und der Wert wird hier genau einmal
 * beim ersten Laden gebraucht.
 */
function gewaehlteFassung(): string | null {
  if (typeof window === 'undefined') return null;
  const wert = new URLSearchParams(window.location.search).get(VERSION_QUERY_PARAM);
  if (!wert) return null;
  const nummer = Number(wert.replace(',', '.'));
  return Number.isFinite(nummer) && nummer > 0 ? formatVersionNumber(nummer) : null;
}

export default function ReviewPage() {
  const params = useParams<{ videoId: string }>();
  const videoId = params.videoId;
  const { user } = useSession();
  const { completedCount, enqueue } = useUploads();
  const t = useT();
  const kindName = useAiKindName();
  const zeigeName = useUserName();
  const { formatRelative } = useFormat();

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
  const [sharing, setSharing] = useState(false);
  /** Einbetten liegt seit Phase 23 im „…"-Menü, nicht mehr bei den Freigaben. */
  const [embedding, setEmbedding] = useState(false);
  /** Nachfrage vor dem Löschen – eine Fassung ist samt Kommentaren weg. */
  const [versionToDelete, setVersionToDelete] = useState<VersionDto | null>(null);
  /** Fassungsnummer der gewählten Fassung ändern (Phase 25). */
  const [renumbering, setRenumbering] = useState(false);
  const [draftAnnotation, setDraftAnnotation] = useState<Annotation | null>(null);
  /** Offenes Download-Fenster samt der Auskunft, die den Knopf ausgelöst hat. */
  const [downloads, setDownloads] = useState<VersionDownloadsDto | null>(null);
  /** Katalog der KI-Arten fürs Team (Phase 24, Nachtrag); Gäste brauchen ihn nicht. */
  const [aiKatalog, setAiKatalog] = useState<AiContentSettingsDto | null>(null);

  const isTeam = user?.role === 'ADMIN' || user?.role === 'MEMBER';

  // Der Katalog ändert sich selten; einmal je Seitenaufruf genügt.
  useEffect(() => {
    if (!isTeam) return;
    void api
      .getAiSettings()
      .then(setAiKatalog)
      .catch(() => {
        // Ohne Katalog fehlt nur die Schalter-Zeile; der Hinweis am Video
        // kommt unabhängig davon aus dem Video-DTO.
      });
  }, [isTeam]);

  /**
   * Team oder externer Projektadmin (Phase 21): darf Fassungen hochladen und
   * löschen, weiter freigeben – aber nicht das Video umbenennen oder löschen,
   * das bleibt dem Team vorbehalten.
   */
  const canManage = isTeam || (video?.canManage ?? false);
  const router = useRouter();
  const [seitenTab, setSeitenTab] = useState<'kommentare' | 'freigaben' | 'benachrichtigungen'>(
    'kommentare',
  );
  /** Im Vollbild lebt die Kommentarspalte im Player, nicht in der Seitenleiste. */
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [editingVideo, setEditingVideo] = useState(false);
  const [deletingVideo, setDeletingVideo] = useState(false);

  const selectedVersion = useMemo(
    () => versions.find((version) => version.id === selectedVersionId) ?? null,
    [versions, selectedVersionId],
  );

  /**
   * Der Herunterladen-Knopf (Phase 19). Das Fenster geht seit Phase 23
   * **immer** auf, auch ohne eingerichtete Formate: Dort steht der Dateiname,
   * unter dem die Datei gleich auf der Platte landet, und bei einem
   * Zwischenstand die Warnung dazu. Beides ist nach dem Klick nicht mehr zu
   * haben.
   *
   * Die Auskunft wird beim Klick geholt und ins Fenster durchgereicht – so
   * muss die Fassung sie nicht dauernd mit sich herumtragen. Antwortet sie
   * nicht, bleibt der Direktlink als Rückfall.
   */
  const starteDownload = useCallback(async (versionId: string) => {
    try {
      setDownloads(await api.listDownloads(versionId));
    } catch {
      window.location.href = mediaUrl.original(versionId);
    }
  }, []);

  /** Ablagefläche sichtbar? Wird am Schreibtisch vom „+" auf- und zugeklappt. */
  const [uploaderOffen, setUploaderOffen] = useState(false);

  /**
   * Neue Fassung (Phase 24): Am Schreibtisch klappt das „+" die Ablagefläche
   * auf – dorthin zieht man die Datei direkt aus dem Finder. Auf einem Gerät
   * ohne Zeiger gibt es nichts zu ziehen; dort öffnet es gleich die
   * Dateiauswahl.
   */
  const neueFassung = useCallback(async () => {
    if (!video) return;
    if (hatZeiger()) {
      setUploaderOffen((offen) => !offen);
      return;
    }
    const files = (await pickFiles({ accept: VIDEO_ACCEPT })).filter((file) => file.size > 0);
    if (files.length === 0) return;
    enqueue({ files, target: 'video', projectId: video.projectId, videoId: video.id });
  }, [video, enqueue]);

  const loadVideo = useCallback(async () => {
    try {
      const [videoData, versionData] = await Promise.all([
        api.getVideo(videoId),
        api.listVersions(videoId),
      ]);
      setVideo(videoData);
      setVersions(versionData);
      setSelectedVersionId((current) => {
        if (current) return current;
        /*
         * `?fassung=2.5` in der Adresse wählt genau diese Fassung vor
         * (Phase 27). Genau diesen Link legt die API als `webUrl` an jede
         * Fassung – eine Anbindung kann nach dem Hochladen also „Im Browser
         * öffnen" anbieten, ohne unsere Routen zu kennen. Gibt es die Nummer
         * nicht (mehr), bleibt es bei der neuesten.
         */
        const gewuenscht = gewaehlteFassung();
        if (gewuenscht !== null) {
          const treffer = versionData.find(
            (version) => formatVersionNumber(version.versionNumber) === gewuenscht,
          );
          if (treffer) return treffer.id;
        }
        return versionData[0]?.id ?? null;
      });
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  /**
   * Interne Fassung freigeben (Phase 27). Mit Rückfrage: Danach steht sie beim
   * Kunden, und ein Zurücknehmen ändert nichts mehr daran, dass er sie in der
   * Zwischenzeit vielleicht schon gesehen hat.
   */
  const freigeben = useCallback(
    async (versionId: string) => {
      if (!window.confirm(t('video.internalReleaseConfirm'))) return;
      try {
        await api.releaseVersion(versionId);
        await loadVideo();
      } catch (releaseError) {
        setError(releaseError instanceof Error ? releaseError.message : t('common.saveFailed'));
      }
    },
    [loadVideo, t],
  );

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

  /**
   * Live: Kommentare anderer und der Stand der Verarbeitung kommen von selbst
   * an (Phase 18, Zusatz).
   */
  useLiveTopic('video', videoId, () => {
    void loadVideo();
    void loadComments();
  });

  // Der alte Takt bleibt als Sicherheitsnetz: Steht die Live-Verbindung
  // nicht – etwa hinter einem Proxy, der SSE kappt –, wird wie früher
  // nachgeladen, sonst nur noch selten.
  const processing =
    selectedVersion?.status === 'PROCESSING' || selectedVersion?.status === 'UPLOADING';
  const takt = useFallbackInterval(processing ? 3000 : null);
  useEffect(() => {
    if (takt === null) return;
    const timer = setInterval(() => void loadVideo(), takt);
    return () => clearInterval(timer);
  }, [takt, loadVideo]);

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
          label: `${zeigeName(comment.author)}: ${comment.body.slice(0, 60)}`,
        })),
    [comments, zeigeName],
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

  /**
   * Eine einzige Instanz, wahlweise in der Seitenleiste oder – im Vollbild,
   * wo die Seitenleiste für den Browser unsichtbar ist – im Player selbst
   * (siehe `fullscreenPanel` unten). Nie beide zugleich, sonst liefe der
   * Kommentar-Editor doppelt.
   */
  const commentPanel = (
    <CommentPanel
      comments={comments}
      currentUser={user}
      canManageComments={canManage}
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
  );

  return (
    <AppShell>
      <div className="review">
        {/* Die Hülle scrollt am Schreibtisch als eine Spalte. Auf schmalem
            Schirm löst sie sich auf (`display: contents`), damit Player,
            Kommentare und Kennwerte einzeln geordnet werden können. */}
        <div className="review__col">
        <div className="review__main">
          <div className="breadcrumb">
            <Link href="/projekte">{t('shell.projects')}</Link>
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

          {/*
           * Auf dem Handy stapelt sich diese Leiste in drei Zeilen: Titel,
           * darunter die Fassungswahl über die volle Breite, darunter
           * rechtsbündig die Aktionen (Phase 24). Nebeneinander gequetscht
           * rutschten die Symbole vorher über den rechten Rand hinaus.
           */}
          <div className="toolbar videobar">
            <h1 className="page__title videobar__title">{video?.name ?? t('video.title')}</h1>
            {/* Wann kam die Fassung? Stand bis Phase 28 nirgends – auch der
                Kunde sieht es jetzt, und zwar an der Stelle, an der er die
                Nummer liest. */}
            {selectedVersion ? (
              <span className="faint" style={{ fontSize: 13 }}>
                {formatRelative(selectedVersion.createdAt)}
              </span>
            ) : null}
            {selectedVersion ? <VersionStatusBadge version={selectedVersion} /> : null}
            {/*
             * Zustand der Fassung als Chips (Phase 28) – fürs Team zugleich
             * die Schalter. Vorher standen dafür zwei Leisten unter dem Titel.
             */}
            {video && selectedVersion ? (
              <VersionChips
                video={video}
                version={selectedVersion}
                isTeam={isTeam}
                aiKatalog={aiKatalog}
                onChanged={loadVideo}
              />
            ) : null}

            <div className="shell__spacer" />

            {versions.length > 0 ? (
              <select
                className="select videobar__versions"
                value={selectedVersionId ?? ''}
                onChange={(event) => {
                  setSelectedVersionId(event.target.value);
                  setActiveCommentId(null);
                  setDraftFrame(null);
                }}
                aria-label={t('video.version')}
              >
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {t('video.versionOption', {
                      label:
                        versionLabel(version.versionNumber) +
                        (version.label ? ` – ${version.label}` : '') +
                        // In einer Auswahlliste geht kein eigenes Abzeichen –
                        // deshalb steht „intern" im Text (Phase 27).
                        (version.internal ? ` · ${t('video.internal')}` : ''),
                      count: version.commentCount,
                    })}
                  </option>
                ))}
              </select>
            ) : null}

            <div className="videobar__actions">
              {/* Symbole statt Textknöpfe – die Leiste war voll (Phase 16).
                  Was seltener gebraucht wird, steht im „…"-Menü daneben; wer
                  Zugriffe sehen will, nimmt den Reiter „Freigaben" rechts.
                  Ab Phase 21 auch für den externen Projektadmin, nicht nur
                  fürs Team. */}
              {canManage ? (
                <>
                  <IconButton
                    icon="plus"
                    label={t('video.uploadNewVersion')}
                    onClick={() => void neueFassung()}
                  />
                  <IconButton
                    icon="share"
                    label={t('video.manageShares')}
                    onClick={() => setSharing(true)}
                  />
                </>
              ) : null}

              {/* Sind Download-Formate eingerichtet, öffnet der Knopf ein
                  Fenster mit der Auswahl (Phase 19); sonst bleibt es beim
                  Direktlink aufs Original. Entschieden wird das an der Antwort,
                  statt die Auskunft an jeder Fassung mitzuschleppen. */}
              {selectedVersion?.status === 'READY' && selectedVersion.canDownload ? (
                <IconButton
                  icon="download"
                  label={t('video.download')}
                  onClick={() => void starteDownload(selectedVersion.id)}
                />
              ) : null}

              {canManage ? (
                <Menu label={t('video.actions')}>
                  <MenuItem onSelect={() => void neueFassung()}>
                    {t('video.newVersionEllipsis')}
                  </MenuItem>
                  <MenuItem onSelect={() => setSharing(true)}>{t('video.shareEllipsis')}</MenuItem>
                  <MenuItem onSelect={() => setEmbedding(true)}>{t('video.embedEllipsis')}</MenuItem>
                  {/* Umbenennen und Löschen des Videos bleiben dem Team
                      vorbehalten – „Videos anlegen" hieß nicht „verwalten". */}
                  {isTeam ? (
                    <MenuItem onSelect={() => setEditingVideo(true)}>{t('video.renameEllipsis')}</MenuItem>
                  ) : null}
                  {selectedVersion ? (
                    <MenuItem onSelect={() => setRenumbering(true)}>
                      {t('video.renumberEllipsis')}
                    </MenuItem>
                  ) : null}
                  {selectedVersion ? (
                    <MenuItem danger onSelect={() => setVersionToDelete(selectedVersion)}>
                      {t('video.deleteVersionEllipsis')}
                    </MenuItem>
                  ) : null}
                  {isTeam ? (
                    <MenuItem danger onSelect={() => setDeletingVideo(true)}>
                      {t('video.deleteEllipsis')}
                    </MenuItem>
                  ) : null}
                </Menu>
              ) : null}
            </div>
          </div>

          {uploaderOffen && video && canManage ? (
            <Uploader projectId={video.projectId} videoId={video.id} />
          ) : null}

          {/* Interne Fassung (Phase 27): Der Hinweis richtet sich ans Team –
              Gäste sehen die Fassung ohnehin nicht. Freigeben darf **jeder**
              aus dem Team, das ist kein Admin-Vorrecht. */}
          {selectedVersion?.internal ? (
            <div className="notice notice--warn">
              <strong>{t('video.internalTitle')}</strong> {t('video.internalBody')}
              {isTeam ? (
                <p style={{ marginBottom: 0, marginTop: 8 }}>
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => void freigeben(selectedVersion.id)}
                  >
                    {t('video.internalRelease')}
                  </button>
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Solange keine Endfassung markiert ist, sagt es die Seite – zuerst
              dem Kunden, der sonst eine Zwischenfassung für das Ergebnis
              hält. Das Team sieht denselben Hinweis samt Schalter. */}
          {selectedVersion && !selectedVersion.isFinal ? (
            <div className="notice notice--warn">
              <strong>{t('video.notFinalTitle')}</strong> {t('video.notFinalBody')}
              {isTeam ? t('video.notFinalTeam') : ''}
            </div>
          ) : null}

          {/* KI-Kennzeichnung (Phase 24, Nachtrag): Der Hinweis richtet sich an
              den Auftraggeber und steht deshalb für **alle** Betrachter da,
              auch Gäste – über alle Fassungen des Videos hinweg. */}
          {video?.aiContent ? (
            <div className="notice notice--warn">
              <strong>{t('video.aiTitle')}</strong>
              {video.aiKinds.length > 0
                ? ` (${video.aiKinds.map(kindName).join(', ')})`
                : ''}{' '}
              {t('video.aiBody')}
            </div>
          ) : null}

          {error ? <div className="notice">{error}</div> : null}
          {loading ? <p className="muted">{t('common.loading')}</p> : null}

          {selectedVersion ? (
            <>
              <VideoPlayer
                ref={playerRef}
                version={selectedVersion}
                markers={markers}
                activeCommentId={activeCommentId}
                shownAnnotation={shownAnnotation}
                canComment={canComment}
                onDraftAnnotationChange={(annotation) => {
                  setDraftAnnotation(annotation);
                  if (annotation) {
                    // Eine Zeichnung braucht einen Frame – sonst würde sie beim
                    // Absenden als „ohne Zeitbezug" stillschweigend verworfen
                    // (Phase 21 Bugfix). Steht schon einer fest (via „C"),
                    // bleibt der bestehen statt zu wandern.
                    setPinned(true);
                    setDraftFrame((current) => current ?? currentFrame);
                  }
                }}
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
                fullscreenPanel={commentPanel}
                onFullscreenChange={setPlayerFullscreen}
              />

              {/* Steht **nach** der Kommentarspalte, sobald gestapelt wird –
                  siehe `.review` im Stylesheet. Wer auf dem Handy scrollt,
                  will unter dem Bild die Kommentare, nicht die Kennwerte. */}
            </>
          ) : (
            !loading && (
              <div className="empty">
                {t('video.noFileYet')}
                {video && canManage ? (
                  <div style={{ marginTop: 12 }}>
                    {/* Auf einer leeren Seite darf die Fläche direkt stehen –
                        sie ist hier die eine Handlung, die ansteht. Ihren
                        Knopf bringt sie für Geräte ohne Zeiger selbst mit. */}
                    <Uploader projectId={video.projectId} videoId={video.id} />
                  </div>
                ) : null}
              </div>
            )
          )}
        </div>

        {selectedVersion ? (
          <div className="review__details">
            <VersionDetails version={selectedVersion} />
            <ShortcutHelp />
          </div>
        ) : null}
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
                {t('video.tabComments')}
              </button>
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
                title={t('notifications.tabTitle')}
              >
                {t('video.tabNotifications')}
              </button>
            </div>
          ) : null}

          {isTeam && seitenTab === 'freigaben' && video ? (
            <SharePanel
              scope="VIDEO"
              projectId={video.projectId}
              videoId={video.id}
              targetLabel={video.name}
              video={video}
              onVideoChanged={loadVideo}
            />
          ) : isTeam && seitenTab === 'benachrichtigungen' && video ? (
            <NotificationPanel scope="VIDEO" projectId={video.projectId} videoId={video.id} />
          ) : playerFullscreen ? null : (
            commentPanel
          )}
        </aside>
      </div>

      {sharing && video ? (
        <ShareManager
          scope="VIDEO"
          projectId={video.projectId}
          videoId={video.id}
          targetLabel={video.name}
          onClose={() => setSharing(false)}
          canManage={isTeam}
        />
      ) : null}

      {embedding && video ? (
        <EmbedDialog
          videoId={video.id}
          videoName={video.name}
          hatEndfassung={versions.some(
            (fassung) => fassung.isFinal && fassung.status === 'READY',
          )}
          onClose={() => setEmbedding(false)}
        />
      ) : null}

      {downloads && selectedVersion && video ? (
        <DownloadDialog
          versionId={selectedVersion.id}
          videoId={video.id}
          initial={downloads}
          onClose={() => setDownloads(null)}
        />
      ) : null}


      {renumbering && selectedVersion ? (
        <RenumberVersionDialog
          version={selectedVersion}
          andere={versions
            .filter((eintrag) => eintrag.id !== selectedVersion.id)
            .map((eintrag) => eintrag.versionNumber)}
          onClose={() => setRenumbering(false)}
          onSaved={async () => {
            setRenumbering(false);
            await loadVideo();
          }}
        />
      ) : null}

      {versionToDelete ? (
        <Dialog
          title={t('video.deleteVersionTitle', {
            label: versionLabel(versionToDelete.versionNumber),
          })}
          onClose={() => setVersionToDelete(null)}
        >
          <p style={{ marginTop: 0 }}>
            {t('video.deleteVersionBody', { count: versionToDelete.commentCount })}
          </p>
          <p className="muted" style={{ fontSize: 13 }}>
            {versionToDelete.originalFilename}
          </p>
          <div className="dialog__actions">
            <button type="button" className="button" onClick={() => setVersionToDelete(null)}>
              {t('common.cancel')}
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
                    deleteError instanceof Error ? deleteError.message : t('common.deleteFailed'),
                  );
                }
              }}
            >
              {t('common.deleteFinally')}
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
  const zeigeName = useUserName();
  const t = useT();
  const { formatBytes, formatFrameRate, formatDateTime } = useFormat();
  const media = version.media;
  const entries: Array<[string, string]> = [
    [t('video.detailFile'), version.originalFilename],
    [t('video.detailSize'), formatBytes(version.originalSizeBytes)],
    [
      t('video.detailResolution'),
      media.width && media.height ? `${media.width} × ${media.height}` : '–',
    ],
    [t('video.detailFrameRate'), formatFrameRate(media.frameRate)],
    [
      t('video.detailCounting'),
      media.frameRate ? (media.dropFrame ? 'Drop-Frame' : 'Non-Drop') : '–',
    ],
    [t('video.detailStartTimecode'), media.startTimecode ?? '–'],
    [t('video.detailFrames'), media.frameCount ? String(media.frameCount) : '–'],
    [t('video.detailCodec'), media.videoCodec ?? '–'],
    [t('video.detailUploadedBy'), zeigeName(version.uploadedBy) || '–'],
    // Das genaue Datum klein daneben (Phase 28): Die relative Angabe oben
    // sagt „vor 3 Tagen", hier steht, welcher Tag das war.
    [t('video.detailUploadedAt'), formatDateTime(version.createdAt)],
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

/**
 * Fassungsnummer nachträglich ändern (Phase 25) – zum Begradigen von
 * Fehleingaben. Anders als beim Hochladen darf die Nummer auch **unter** der
 * höchsten liegen; nur frei und größer 0 muss sie sein. Geprüft wird schon
 * beim Tippen mit derselben Funktion, die auch die API benutzt.
 */
function RenumberVersionDialog({
  version,
  andere,
  onClose,
  onSaved,
}: {
  version: VersionDto;
  /** Die Nummern der übrigen Fassungen des Videos. */
  andere: number[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [eingabe, setEingabe] = useState(formatVersionNumber(version.versionNumber));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  const wert = Number(eingabe.trim().replace(',', '.'));
  const unveraendert =
    Number.isFinite(wert) && wert === Number(version.versionNumber.toFixed(3));
  const problem =
    eingabe.trim() === ''
      ? null
      : !Number.isFinite(wert)
        ? { message: t('video.renumberNaN') }
        : unveraendert
          ? null
          : (() => {
              const ergebnis = checkVersionRenumber(wert, andere);
              if (ergebnis.ok) return null;
              // Nicht `ergebnis.message` nehmen: Der Satz ist immer Deutsch,
              // weil dieselbe Prüfung in der API läuft und dort erst der
              // Fehlerfilter beim Hinausgehen übersetzt. Hier im Browser gibt
              // es den nicht – also über den Grund ins Wörterbuch.
              if (ergebnis.reason === 'zu-gross') {
                return { message: t('video.renumberTooLarge', { max: VERSION_NUMBER_MAX }) };
              }
              if (ergebnis.reason === 'vergeben') {
                return { message: t('video.renumberTaken', { label: versionLabel(wert) }) };
              }
              return { message: t('video.renumberTooSmall') };
            })();

  const kannSpeichern = eingabe.trim() !== '' && Number.isFinite(wert) && !problem && !unveraendert && !busy;

  return (
    <Dialog
      title={t('video.renumberTitle', { label: versionLabel(version.versionNumber) })}
      onClose={onClose}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!kannSpeichern) return;
          setBusy(true);
          setError(null);
          try {
            await api.updateVersion(version.id, { versionNumber: wert });
            await onSaved();
          } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : t('common.changeFailed'));
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="renumber-version">
            {t('video.renumberNewNumber')}
          </label>
          <input
            id="renumber-version"
            className="input"
            style={{ width: 140 }}
            inputMode="decimal"
            autoFocus
            value={eingabe}
            onChange={(event) => setEingabe(event.target.value)}
          />
          <p className="hint">
            {t('video.renumberHint')}
            {problem ? ` ${problem.message}` : ''}
          </p>
        </div>

        {error ? <div className="notice">{error}</div> : null}

        <div className="dialog__actions">
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="button button--primary" disabled={!kannSpeichern}>
            {t('video.renumberSubmit')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ShortcutHelp() {
  const t = useT();
  const shortcuts: Array<[string, string]> = [
    [t('shortcuts.spaceKey'), t('shortcuts.playPause')],
    ['J / K / L', t('shortcuts.jkl')],
    ['← →', t('shortcuts.frame')],
    ['⇧ + ← →', t('shortcuts.second')],
    ['Pos1 / Ende', t('shortcuts.startEnd')],
    ['C', t('shortcuts.comment')],
    ['M', t('shortcuts.mute')],
    ['F', t('shortcuts.fullscreen')],
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
