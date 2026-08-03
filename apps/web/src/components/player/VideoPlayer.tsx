'use client';

import {
  ANNOTATION_COLORS,
  ANNOTATION_STROKE_WIDTHS,
  type Annotation,
  DEFAULT_ANNOTATION_WIDTH,
  type FrameRate,
  type VersionDto,
  formatDuration,
  frameToDisplayTimecode,
  frameToSeekTime,
  framesToSeconds,
  isAnnotationEmpty,
} from '@klappe/shared';
import {
  type CSSProperties,
  type ReactNode,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { mediaUrl } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useHlsSource } from './useHlsSource';
import { Icon } from '@/components/ui/Icon';
import { AnnotationCanvas } from './AnnotationCanvas';
import { Timeline } from './Timeline';
import { useFrameClock } from './useFrameClock';

export interface PlayerHandle {
  seekToFrame: (frame: number) => void;
  getFrame: () => number;
  pause: () => void;
  /** Zeichenmodus einschalten und die Fläche leeren. */
  startDrawing: () => void;
  clearDrawing: () => void;
}

export interface CommentMarker {
  id: string;
  frame: number;
  resolved: boolean;
  label: string;
}

interface VideoPlayerProps {
  version: VersionDto;
  markers: CommentMarker[];
  activeCommentId?: string | null;
  /** Zeichnung eines ausgewählten Kommentars, die eingeblendet werden soll. */
  shownAnnotation?: Annotation | null;
  /** Darf hier gezeichnet und kommentiert werden? */
  canComment?: boolean;
  onMarkerClick?: (commentId: string) => void;
  onFrameChange?: (frame: number) => void;
  onRequestComment?: (frame: number) => void;
  /** Meldet die gerade gezeichnete Skizze an die Review-Seite. */
  onDraftAnnotationChange?: (annotation: Annotation | null) => void;
  /**
   * Die Kommentarspalte, als von rechts einfahrende Leiste innerhalb des
   * Vollbilds gerendert (Phase 21) – außerhalb des Vollbild-Elements sieht
   * der Browser sie gar nicht, egal was `onRequestComment` auslöst.
   */
  fullscreenPanel?: ReactNode;
  /** Meldet Ein-/Austritt aus dem Vollbild an die Review-Seite. */
  onFullscreenChange?: (active: boolean) => void;
}

/** Stufen für J/K/L – wie im Schnittprogramm. */
const SHUTTLE_RATES = [1, 2, 4, 8] as const;

/** Merkt sich, ob Zeichnungen in Fahrt sichtbar bleiben (Phase 20). */
const SPEICHER_ZEICHNUNG = 'klappe.zeichnung-bei-fahrt';

/**
 * Kantenlänge der Symbole in der Bedienleiste (1.5). Zwei Pixel größer als das
 * Standardmaß der übrigen Werkzeugleisten: Hier wird im Zweifel mit dem Daumen
 * getroffen, und die Leiste steht auf dunklem Grund.
 */
const PLAYER_ICON = 20;

export const VideoPlayer = forwardRef<PlayerHandle, VideoPlayerProps>(function VideoPlayer(
  {
    version,
    markers,
    activeCommentId,
    shownAnnotation,
    canComment = true,
    onMarkerClick,
    onFrameChange,
    onRequestComment,
    onDraftAnnotationChange,
    fullscreenPanel,
    onFullscreenChange,
  },
  ref,
) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  /** Negativ = rückwärts, 0 = steht. */
  const [rate, setRate] = useState(0);
  const [muted, setMuted] = useState(false);
  const [buffered, setBuffered] = useState(0);

  // ---------- Zeichnen (Phase 5) ----------
  const [drawingMode, setDrawingMode] = useState(false);
  const [draftAnnotation, setDraftAnnotation] = useState<Annotation | null>(null);
  const [penColor, setPenColor] = useState<string>(ANNOTATION_COLORS[0]);
  const [penWidth, setPenWidth] = useState<number>(DEFAULT_ANNOTATION_WIDTH);

  /**
   * Zeichnungen während Wiedergabe und Scrubbing (Phase 20).
   *
   * Eine Zeichnung gehört zu genau einem Bild. Beim Abspielen blitzt sie
   * deshalb für den Bruchteil einer Sekunde auf, und beim Durchziehen der
   * Zeitleiste flackert es an jeder Anmerkung. Wer den Film am Stück sehen
   * will, schaltet das hier ab; wer nach Anmerkungen sucht, lässt es an.
   * Die Wahl bleibt im Browser, nicht am Video – sie sagt etwas über die
   * Arbeitsweise, nicht über den Film.
   */
  /**
   * Zeichnungen **während der Fahrt** einblenden? Ab Werk nein (1.5): Eine
   * Zeichnung gehört zu genau einem Bild. Läuft sie mit, klebt sie über
   * Sekunden im Bild und meint dort längst etwas anderes – gemeint war der
   * eine Frame, auf dem sie entstanden ist. Wer sie sehen will, hält an.
   */
  const [zeichnungBeiFahrt, setZeichnungBeiFahrt] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const scrubTimer = useRef<number | null>(null);

  // ---------- Vollbild + Kommentarspalte (Phase 21) ----------
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  /**
   * Gemeint ist hier nur der **Rahmen** im Vollbild: Nur dann liegt die
   * Kommentarspalte innerhalb des Vollbild-Elements und ist überhaupt
   * sichtbar. Das iOS-eigene Video-Vollbild zählt bewusst nicht dazu – dort
   * zeichnet Safari über allem, was wir rendern, und die Spalte bleibt
   * richtigerweise in der Seitenleiste.
   */
  useEffect(() => {
    const onChange = () => {
      const active = vollbildElement() === containerRef.current;
      setIsFullscreen(active);
      if (!active) setPanelOpen(false);
      onFullscreenChange?.(active);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frameRate: FrameRate | null = version.media.frameRate;
  const frame = useFrameClock(videoRef, frameRate, ready);

  const totalFrames = useMemo(() => {
    if (version.media.frameCount && version.media.frameCount > 0) return version.media.frameCount;
    return 0;
  }, [version.media.frameCount]);

  const timecodeContext = useMemo(
    () => ({
      fps: frameRate ?? { num: 25, den: 1 },
      dropFrame: version.media.dropFrame,
      startFrames: version.media.startTimecodeFrames,
    }),
    [frameRate, version.media.dropFrame, version.media.startTimecodeFrames],
  );

  useEffect(() => {
    onFrameChange?.(frame);
  }, [frame, onFrameChange]);

  // Die gespeicherte Wahl erst nach dem ersten Rendern lesen – auf dem Server
  // gibt es kein `localStorage`, und ein Unterschied zwischen Server- und
  // Browser-Fassung würde React beim Hydrieren bemängeln.
  useEffect(() => {
    // Nur ein ausdrückliches „an" schaltet ein – fehlt der Eintrag, gilt der
    // Standard von oben.
    setZeichnungBeiFahrt(window.localStorage.getItem(SPEICHER_ZEICHNUNG) === 'an');
  }, []);

  useEffect(() => () => {
    if (scrubTimer.current) window.clearTimeout(scrubTimer.current);
  }, []);

  /**
   * Scrubbing hat kein eigenes Ereignis „fertig". Statt die Zeitleiste um
   * einen Zustand zu erweitern, gilt hier: Wer gerade gesprungen ist, ist für
   * einen Augenblick noch in Bewegung. Jeder weitere Sprung schiebt das Ende
   * nach hinten, ein Standbild bleibt also nach kurzem Zögern stehen.
   */
  const meldeSprung = useCallback(() => {
    setScrubbing(true);
    if (scrubTimer.current) window.clearTimeout(scrubTimer.current);
    scrubTimer.current = window.setTimeout(() => setScrubbing(false), 260);
  }, []);

  /** In Fahrt heißt: läuft, spult, oder wurde eben noch gescrubbt. */
  const inFahrt = rate !== 0 || scrubbing;
  /**
   * Eine fertig gezeichnete, aber noch nicht abgeschickte Skizze bleibt auf
   * dem Bild sichtbar, bis sie gesendet oder verworfen wird – sonst
   * verschwindet sie mit „Fertig" scheinbar, obwohl sie weiterhin am
   * Kommentar hängt (Phase 21 Bugfix).
   */
  const ausstehendeZeichnung =
    !drawingMode && draftAnnotation && !isAnnotationEmpty(draftAnnotation) ? draftAnnotation : null;
  const sichtbareZeichnung = inFahrt && !zeichnungBeiFahrt
    ? null
    : (ausstehendeZeichnung ?? shownAnnotation ?? null);

  const seekToFrame = useCallback(
    (target: number) => {
      const video = videoRef.current;
      if (!video || !frameRate) return;
      const limit = totalFrames > 0 ? totalFrames - 1 : Number.MAX_SAFE_INTEGER;
      const clamped = Math.max(0, Math.min(target, limit));
      video.currentTime = frameToSeekTime(clamped, frameRate);
    },
    [frameRate, totalFrames],
  );

  const stopTransport = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.playbackRate = 1;
    setRate(0);
  }, []);

  const playForward = useCallback((speed: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    void video.play().catch(() => undefined);
    setRate(speed);
  }, []);

  const playReverse = useCallback((speed: number) => {
    const video = videoRef.current;
    if (!video) return;
    // `<video>` kann nicht rückwärts abspielen: negative `playbackRate` wird
    // von keinem Browser unterstützt. Deshalb pausieren wir und schieben die
    // Abspielposition selbst zurück (siehe Effekt weiter unten).
    video.pause();
    video.playbackRate = 1;
    setRate(-speed);
  }, []);

  /** Rückwärtslauf: eigene Schleife, die `currentTime` zurückschiebt. */
  useEffect(() => {
    if (rate >= 0) return;
    const video = videoRef.current;
    if (!video) return;

    let handle = 0;
    let last = performance.now();

    const step = (now: number) => {
      const deltaSeconds = ((now - last) / 1000) * Math.abs(rate);
      last = now;
      const next = video.currentTime - deltaSeconds;
      if (next <= 0) {
        video.currentTime = 0;
        setRate(0);
        return;
      }
      video.currentTime = next;
      handle = requestAnimationFrame(step);
    };

    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [rate]);

  const togglePlay = useCallback(() => {
    if (rate !== 0) {
      stopTransport();
      return;
    }
    playForward(1);
  }, [rate, stopTransport, playForward]);

  const shuttle = useCallback(
    (direction: 1 | -1) => {
      const currentIndex = SHUTTLE_RATES.indexOf(Math.abs(rate) as (typeof SHUTTLE_RATES)[number]);
      const sameDirection = Math.sign(rate) === direction;
      const nextIndex = sameDirection ? Math.min(currentIndex + 1, SHUTTLE_RATES.length - 1) : 0;
      const speed = SHUTTLE_RATES[nextIndex];
      if (direction === 1) playForward(speed);
      else playReverse(speed);
    },
    [rate, playForward, playReverse],
  );

  const stepFrames = useCallback(
    (delta: number) => {
      stopTransport();
      seekToFrame(frame + delta);
    },
    [frame, seekToFrame, stopTransport],
  );

  const setDraft = useCallback(
    (next: Annotation | null) => {
      setDraftAnnotation(next);
      onDraftAnnotationChange?.(next && !isAnnotationEmpty(next) ? next : null);
    },
    [onDraftAnnotationChange],
  );

  /** Skizze verwerfen und den Zeichenmodus verlassen – nach dem Absenden oder beim bewussten Verwerfen. */
  const clearDrawing = useCallback(() => {
    setDraft(null);
    setDrawingMode(false);
  }, [setDraft]);

  /**
   * Zeichnen beenden, ohne die Skizze zu verwerfen (Phase 21 Bugfix). Vorher
   * rief „Fertig" dieselbe Funktion wie das Verwerfen auf – die gerade
   * gezeichnete Skizze war damit weg, noch bevor sie an einen Kommentar
   * geheftet werden konnte.
   */
  const finishDrawing = useCallback(() => {
    setDrawingMode(false);
  }, []);

  const startDrawing = useCallback(() => {
    // Zeichnen auf einem laufenden Bild ergibt keinen Sinn – der Frame, auf
    // den sich die Skizze bezieht, wäre beim Loslassen schon vorbei.
    stopTransport();
    setDrawingMode(true);
  }, [stopTransport]);

  /**
   * Kommentar am aktuellen Bild anfordern. Im Vollbild fährt zusätzlich die
   * Kommentarspalte von rechts ein – ohne das bliebe der Knopf dort wirkungslos,
   * weil alles außerhalb des Vollbild-Elements für den Browser unsichtbar ist.
   */
  const requestComment = useCallback(() => {
    stopTransport();
    if (isFullscreen) setPanelOpen(true);
    onRequestComment?.(frame);
  }, [stopTransport, isFullscreen, onRequestComment, frame]);

  /**
   * Dreht man das Handy quer, geht der Player ins Vollbild; zurück ins
   * Hochformat verlässt es wieder (Phase 17). Bewusst nur beim **Wechsel**
   * und nur bei grobem Zeiger: Ein Laptop im Querformat soll nicht plötzlich
   * Vollbild anzeigen, und ungefragtes Vollbild beim ersten Laden wäre
   * übergriffig.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const quer = window.matchMedia('(orientation: landscape) and (hover: none) and (max-height: 560px)');
    const wechsel = (event: MediaQueryListEvent) => {
      // Nur handeln, wenn Lage und Zustand auseinanderlaufen. Sonst würde ein
      // Drehen ins Querformat ein Vollbild, das iOS von sich aus schon
      // gestartet hat, gleich wieder schließen.
      if (event.matches === istVollbild(videoRef.current)) return;
      void toggleFullscreen(containerRef.current, videoRef.current);
    };
    quer.addEventListener('change', wechsel);
    return () => quer.removeEventListener('change', wechsel);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      seekToFrame: (target: number) => {
        stopTransport();
        seekToFrame(target);
      },
      getFrame: () => frame,
      pause: stopTransport,
      startDrawing,
      clearDrawing,
    }),
    [frame, seekToFrame, stopTransport, startDrawing, clearDrawing],
  );

  /** Beim Springen an eine andere Stelle ist die Skizze gegenstandslos. */
  useEffect(() => {
    if (!drawingMode) return;
    setDraft(null);
    // Absichtlich nur am Frame hängend: Ein neuer Frame heißt neues Blatt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  /** Tastaturkürzel – global, solange nicht gerade in ein Feld getippt wird. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey) return;

      const oneSecondInFrames = frameRate ? Math.round(frameRate.num / frameRate.den) : 25;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          togglePlay();
          break;
        case 'k':
        case 'K':
          event.preventDefault();
          stopTransport();
          break;
        case 'l':
        case 'L':
          event.preventDefault();
          shuttle(1);
          break;
        case 'j':
        case 'J':
          event.preventDefault();
          shuttle(-1);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          stepFrames(event.shiftKey ? -oneSecondInFrames : -1);
          break;
        case 'ArrowRight':
          event.preventDefault();
          stepFrames(event.shiftKey ? oneSecondInFrames : 1);
          break;
        case 'Home':
          event.preventDefault();
          stepFrames(-frame);
          break;
        case 'End':
          event.preventDefault();
          if (totalFrames > 0) stepFrames(totalFrames - 1 - frame);
          break;
        case 'm':
        case 'M': {
          event.preventDefault();
          const video = videoRef.current;
          if (video) {
            video.muted = !video.muted;
            setMuted(video.muted);
          }
          break;
        }
        case 'f':
        case 'F':
          event.preventDefault();
          void toggleFullscreen(containerRef.current, videoRef.current);
          break;
        case 'c':
        case 'C':
          event.preventDefault();
          requestComment();
          break;
        case 'd':
        case 'D':
          if (!canComment) break;
          event.preventDefault();
          if (drawingMode) finishDrawing();
          else startDrawing();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    canComment,
    drawingMode,
    finishDrawing,
    frame,
    frameRate,
    requestComment,
    shuttle,
    startDrawing,
    stepFrames,
    stopTransport,
    togglePlay,
    totalFrames,
  ]);

  const durationSeconds = version.media.durationSeconds ?? 0;
  const hasProxy = version.hasProxy && version.status === 'READY';

  // Adaptive Wiedergabe, wenn für diese Fassung eine Leiter erzeugt wurde.
  const hlsPlayback = useHlsSource(videoRef, version, hasProxy);
  const playbackSource = hlsPlayback.source;

  /**
   * Das Seitenverhältnis des Materials, als Stellgröße ans Stylesheet
   * gereicht. Am Schreibtisch bleibt die Bühne bei 16:9 – ein Hochformat
   * bekommt dort seitliche Balken, und die Leisten stehen still. Auf dem
   * einspaltigen Handy-Layout aber war genau das der Fehler (1.3.2): Ein
   * Hochkant-Video schrumpfte in den 16:9-Kasten auf einen schmalen Streifen
   * in der Mitte. Dort folgt die Bühne deshalb dem Bild.
   */
  const bühnenStil = useMemo<CSSProperties | undefined>(() => {
    const { width, height } = version.media;
    if (!width || !height) return undefined;
    return { '--klappe-bild-format': `${width} / ${height}` } as CSSProperties;
  }, [version.media]);

  const onProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.buffered.length === 0 || !video.duration) return;
    setBuffered(video.buffered.end(video.buffered.length - 1) / video.duration);
  }, []);

  return (
    <div className="player" ref={containerRef}>
      <div className="player__stage" style={bühnenStil}>
        {hasProxy ? (
          <video
            ref={videoRef}
            // Bei HLS setzt der Haken oben die Quelle selbst; hier bleibt sie
            // dann leer, sonst lüde der Browser beides.
            src={playbackSource === 'hls' ? undefined : mediaUrl.proxy(version.id)}
            poster={version.hasPoster ? mediaUrl.poster(version.id) : undefined}
            preload="auto"
            playsInline
            onLoadedMetadata={() => setReady(true)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setRate(0)}
            onProgress={onProgress}
            onClick={drawingMode ? undefined : togglePlay}
          />
        ) : (
          <div className="player__placeholder">
            {version.status === 'FAILED'
              ? t('player.processingFailed', {
                  error: version.processingError ?? t('player.unknownError'),
                })
              : version.status === 'UPLOADING'
                ? t('player.stillUploading')
                : t('player.creatingProxy', { percent: version.progress })}
          </div>
        )}

        {hasProxy ? (
          <AnnotationCanvas
            annotation={drawingMode ? draftAnnotation : sichtbareZeichnung}
            drawing={drawingMode}
            color={penColor}
            strokeWidth={penWidth}
            onChange={setDraft}
          />
        ) : null}
      </div>

      {drawingMode ? (
        <div className="pentools">
          <span className="pentools__label">{t('player.pen')}</span>
          {ANNOTATION_COLORS.map((entry) => (
            <button
              key={entry}
              type="button"
              className="pentools__color"
              style={{ background: entry }}
              data-active={entry === penColor}
              aria-label={t('player.penColor', { color: entry })}
              onClick={() => setPenColor(entry)}
            />
          ))}
          <span className="pentools__divider" />
          {ANNOTATION_STROKE_WIDTHS.map((entry, index) => (
            <button
              key={entry}
              type="button"
              className="pentools__width"
              data-active={entry === penWidth}
              aria-label={t('player.strokeWidth', { number: index + 1 })}
              onClick={() => setPenWidth(entry)}
            >
              <span style={{ height: 2 + index * 3 }} />
            </button>
          ))}
          <div className="shell__spacer" />
          <button
            type="button"
            className="button button--ghost"
            onClick={() => setDraft(null)}
            disabled={isAnnotationEmpty(draftAnnotation)}
          >
            {t('player.clearDrawing')}
          </button>
          <button type="button" className="button button--ghost" onClick={finishDrawing}>
            {t('player.doneDrawing')}
          </button>
        </div>
      ) : null}

      {/* Die laufende Frame-Nummer steht in der Skala der Zeitleiste, zwischen
          Start und Ende – dort, wo man sie sucht, und ohne eine eigene Kachel
          in der Steuerleiste zu belegen. */}
      <Timeline
        version={version}
        frame={frame}
        totalFrames={totalFrames}
        durationSeconds={durationSeconds}
        bufferedFraction={buffered}
        markers={markers}
        activeCommentId={activeCommentId}
        disabled={!hasProxy || !frameRate}
        onSeekFrame={(target) => {
          stopTransport();
          seekToFrame(target);
          meldeSprung();
        }}
        onMarkerClick={onMarkerClick}
      />

      <div className="player__controls">
        <button
          type="button"
          className="iconbutton"
          data-mobil="aus"
          onClick={() => shuttle(-1)}
          disabled={!hasProxy}
          title={t('player.rewindTitle')}
          aria-label={t('player.rewind')}
        >
          <Icon name="shuttle-back" size={PLAYER_ICON} />
        </button>
        <button
          type="button"
          className="iconbutton"
          onClick={() => stepFrames(-1)}
          disabled={!hasProxy}
          title={t('player.frameBackTitle')}
          aria-label={t('player.frameBack')}
        >
          <Icon name="frame-back" size={PLAYER_ICON} />
        </button>
        <button
          type="button"
          className="iconbutton"
          onClick={togglePlay}
          disabled={!hasProxy}
          title={t('player.playPauseTitle')}
          aria-label={playing ? t('player.pause') : t('player.play')}
          data-active={playing}
        >
          <Icon name={rate !== 0 ? 'pause' : 'play'} size={PLAYER_ICON} />
        </button>
        <button
          type="button"
          className="iconbutton"
          onClick={() => stepFrames(1)}
          disabled={!hasProxy}
          title={t('player.frameForwardTitle')}
          aria-label={t('player.frameForward')}
        >
          <Icon name="frame-forward" size={PLAYER_ICON} />
        </button>
        <button
          type="button"
          className="iconbutton"
          data-mobil="aus"
          onClick={() => shuttle(1)}
          disabled={!hasProxy}
          title={t('player.forwardTitle')}
          aria-label={t('player.forward')}
        >
          <Icon name="shuttle-forward" size={PLAYER_ICON} />
        </button>

        <span className="player__rate mono" data-mobil="aus">
          {rate === 0 ? '–' : `${rate > 0 ? '' : '−'}${Math.abs(rate)}×`}
        </span>

        <div className="player__counter">
          <span className="player__timecode mono">
            {frameRate ? frameToDisplayTimecode(frame, timecodeContext) : '--:--:--:--'}
          </span>
        </div>

        <span className="muted mono" style={{ fontSize: 12 }} data-mobil="aus">
          {formatDuration(framesToSeconds(frame, frameRate ?? { num: 25, den: 1 }))} /{' '}
          {formatDuration(durationSeconds)}
        </span>

        {/*
         * Umbruchstelle für schmale Schirme (1.5). Am Handy passt die Leiste
         * nicht in eine Zeile, und sie brach bisher irgendwo um – zuletzt
         * zwischen Stift und Kommentar, was die beiden zusammengehörigen
         * Werkzeuge auseinanderriss. Jetzt bricht sie **hier**: oben das
         * Fahren, unten die Werkzeuge, beide Zeilen für sich mittig.
         *
         * Ein leeres Element mit voller Breite statt zweier Wrapper: Am
         * Schreibtisch bleibt die Leiste damit unverändert eine Zeile.
         */}
        <div className="player__umbruch" aria-hidden />

        <div className="shell__spacer" />

        {/* Stufenwahl der HLS-Leiter (Phase 22). Nur wenn hls.js spielt –
            beim progressiven Proxy gibt es nichts zu wählen, und Safaris
            natives HLS bietet keine Schnittstelle dafür. In der Automatik
            steht die gerade gespielte Stufe in Klammern dabei, damit eine
            stille Herabstufung nicht wie ein Materialfehler aussieht. */}
        {playbackSource === 'hls' && hlsPlayback.qualities.length > 0 ? (
          <select
            className="select player__quality"
            value={hlsPlayback.selectedLevel}
            onChange={(event) => hlsPlayback.setLevel(Number(event.target.value))}
            title={t('player.quality')}
            aria-label={t('player.quality')}
          >
            <option value={-1}>
              Auto
              {hlsPlayback.selectedLevel === -1 && hlsPlayback.activeLabel
                ? ` (${hlsPlayback.activeLabel})`
                : ''}
            </option>
            {hlsPlayback.qualities.map((stufe) => (
              <option key={stufe.index} value={stufe.index}>
                {stufe.label}
              </option>
            ))}
          </select>
        ) : null}

        <button
          type="button"
          className="iconbutton"
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            video.muted = !video.muted;
            setMuted(video.muted);
          }}
          disabled={!hasProxy}
          title={t('player.muteTitle')}
          aria-label={t('player.mute')}
          data-active={muted}
        >
          <Icon name={muted ? 'volume-off' : 'volume'} size={PLAYER_ICON} />
        </button>
        <button
          type="button"
          className="iconbutton"
          onClick={() => void toggleFullscreen(containerRef.current, videoRef.current)}
          disabled={!hasProxy}
          title={t('player.fullscreenTitle')}
          aria-label={t('player.fullscreen')}
        >
          <Icon name="fullscreen" size={PLAYER_ICON} />
        </button>
        <button
          type="button"
          className="iconbutton"
          onClick={() => {
            const neu = !zeichnungBeiFahrt;
            setZeichnungBeiFahrt(neu);
            window.localStorage.setItem(SPEICHER_ZEICHNUNG, neu ? 'an' : 'aus');
          }}
          disabled={!hasProxy}
          title={
            zeichnungBeiFahrt
              ? t('player.hideDrawings')
              : t('player.showDrawings')
          }
          aria-label={t('player.drawingsWhilePlaying')}
          aria-pressed={zeichnungBeiFahrt}
        >
          {/* Ohne `data-active`: Das offene und das durchgestrichene Auge sagen
              den Zustand schon: Eine zusätzliche Einfärbung in der Akzentfarbe
              las sich wie eine Warnung, obwohl hier nichts im Argen liegt. */}
          <Icon name={zeichnungBeiFahrt ? 'eye' : 'eye-off'} size={PLAYER_ICON} />
        </button>
        <button
          type="button"
          className="iconbutton"
          onClick={() => (drawingMode ? finishDrawing() : startDrawing())}
          disabled={!hasProxy || !canComment}
          title={t('player.drawTitle')}
          aria-label={t('player.draw')}
          data-active={drawingMode}
        >
          <Icon name="pen" size={PLAYER_ICON} />
        </button>
        <button
          type="button"
          className="iconbutton"
          onClick={requestComment}
          disabled={!hasProxy || !canComment}
          title={t('player.commentTitle')}
          aria-label={t('player.comment')}
        >
          <Icon name="comment" size={PLAYER_ICON} />
        </button>
      </div>

      {/* Nur im Vollbild gemountet – sonst rendert das die Kommentarspalte
          doppelt, einmal hier und einmal in der Seitenleiste der Review-Seite. */}
      {fullscreenPanel && isFullscreen ? (
        <div className="player__panel" data-open={panelOpen}>
          <div className="player__panel-header">
            <span className="player__panel-title">{t('player.comments')}</span>
            <button
              type="button"
              className="iconbutton"
              onClick={() => setPanelOpen(false)}
              aria-label={t('player.closePanel')}
              title={t('common.close')}
            >
              ✕
            </button>
          </div>
          <div className="player__panel-body">{fullscreenPanel}</div>
        </div>
      ) : null}
    </div>
  );
});

/** Ältere WebKit-Fassungen kennen dieselben Dinge nur mit Präfix. */
type VollbildVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

type VollbildRahmen = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type VollbildDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};

/** Das gerade groß gezogene Element – auch bei WebKit mit Präfix. */
function vollbildElement(): Element | null {
  const doc = document as VollbildDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * Ist irgendetwas groß? Das iPhone zeigt sein Vollbild am `video` selbst,
 * davon weiß `document` nichts – deshalb die zweite Frage.
 */
function istVollbild(video: HTMLVideoElement | null): boolean {
  if (vollbildElement()) return true;
  return (video as VollbildVideo | null)?.webkitDisplayingFullscreen === true;
}

/**
 * Vollbild – mit eigenem Weg für iPhone und iPad.
 *
 * Am Schreibtisch wird der ganze Rahmen groß, damit Zeitleiste, Bedienleiste
 * und die Kommentarspalte mitkommen. Auf dem iPhone kennt Safari das für ein
 * `div` nicht; dort kann nur das `video` selbst über `webkitEnterFullscreen()`
 * groß werden, mit iOS-eigenen Leisten.
 *
 * Genau daran hing der tote Knopf (1.3.2): `requestFullscreen` **gibt es**
 * auf dem iPhone, es lehnt nur ab. Die abgelehnte Zusage wurde verschluckt
 * und danach kehrte die Funktion zurück – der einzige Weg, der dort etwas
 * bewirkt, kam nie an die Reihe. Jetzt entscheidet zuerst `fullscreenEnabled`
 * (auf dem iPhone `false`), und ein trotzdem abgelehnter Versuch fällt weiter
 * durch, statt still zu enden.
 */
async function toggleFullscreen(
  element: HTMLElement | null,
  video: HTMLVideoElement | null,
): Promise<void> {
  const doc = document as VollbildDocument;
  const clip = video as VollbildVideo | null;

  // ---------- verlassen ----------
  if (vollbildElement()) {
    try {
      await (document.exitFullscreen ? document.exitFullscreen() : doc.webkitExitFullscreen?.());
    } catch {
      // Abgelehnt – dann bleibt es eben groß. Ein Fehler wäre hier folgenlos.
    }
    return;
  }
  if (clip?.webkitDisplayingFullscreen) {
    versuche(() => clip.webkitExitFullscreen?.());
    return;
  }

  // ---------- betreten ----------
  const rahmen = element as VollbildRahmen | null;
  const rahmenGehtGross = doc.fullscreenEnabled || doc.webkitFullscreenEnabled === true;
  if (rahmen && rahmenGehtGross) {
    try {
      if (rahmen.requestFullscreen) {
        await rahmen.requestFullscreen();
        return;
      }
      if (rahmen.webkitRequestFullscreen) {
        await rahmen.webkitRequestFullscreen();
        return;
      }
    } catch {
      // Weiter zum Video – lieber iOS-eigene Leisten als ein toter Knopf.
    }
  }

  // Auf dem iPhone der einzige Weg. Bewusst ohne `await` davor, damit der
  // Aufruf in derselben Tipp-Geste steckt, die Safari dafür verlangt.
  versuche(() => clip?.webkitEnterFullscreen?.());
}

/**
 * Die WebKit-Wege werfen, wenn Safari sie gerade nicht erlaubt – etwa beim
 * Drehen, wo keine Tipp-Geste dahintersteckt. Das ist kein Fehler, sondern
 * eine Absage; sie soll nur nicht als unbehandelte Ausnahme enden.
 */
function versuche(aktion: () => void): void {
  try {
    aktion();
  } catch {
    // Absichtlich still.
  }
}
