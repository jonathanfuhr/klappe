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
  const [zeichnungBeiFahrt, setZeichnungBeiFahrt] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);
  const scrubTimer = useRef<number | null>(null);

  // ---------- Vollbild + Kommentarspalte (Phase 21) ----------
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement === containerRef.current;
      setIsFullscreen(active);
      if (!active) setPanelOpen(false);
      onFullscreenChange?.(active);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
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
    setZeichnungBeiFahrt(window.localStorage.getItem(SPEICHER_ZEICHNUNG) !== 'aus');
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
      if (event.matches) {
        void toggleFullscreen(containerRef.current, videoRef.current);
      } else if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
      }
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
  const playbackSource = useHlsSource(videoRef, version, hasProxy);

  const onProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.buffered.length === 0 || !video.duration) return;
    setBuffered(video.buffered.end(video.buffered.length - 1) / video.duration);
  }, []);

  return (
    <div className="player" ref={containerRef}>
      <div className="player__stage">
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
              ? `Die Verarbeitung ist fehlgeschlagen: ${version.processingError ?? 'unbekannter Fehler'}`
              : version.status === 'UPLOADING'
                ? 'Die Datei wird noch hochgeladen …'
                : `Der Proxy wird erzeugt … ${version.progress} %`}
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
          <span className="pentools__label">Stift</span>
          {ANNOTATION_COLORS.map((entry) => (
            <button
              key={entry}
              type="button"
              className="pentools__color"
              style={{ background: entry }}
              data-active={entry === penColor}
              aria-label={`Farbe ${entry}`}
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
              aria-label={`Strichstärke ${index + 1}`}
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
            Leeren
          </button>
          <button type="button" className="button button--ghost" onClick={finishDrawing}>
            Fertig
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
          title="Rückwärts (J)"
          aria-label="Rückwärts"
        >
          ◀◀
        </button>
        <button
          type="button"
          className="iconbutton"
          onClick={() => stepFrames(-1)}
          disabled={!hasProxy}
          title="Ein Bild zurück (←)"
          aria-label="Ein Bild zurück"
        >
          ◀|
        </button>
        <button
          type="button"
          className="iconbutton"
          onClick={togglePlay}
          disabled={!hasProxy}
          title="Abspielen / Pause (Leertaste)"
          aria-label={playing ? 'Pause' : 'Abspielen'}
          data-active={playing}
        >
          {rate !== 0 ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          className="iconbutton"
          onClick={() => stepFrames(1)}
          disabled={!hasProxy}
          title="Ein Bild vor (→)"
          aria-label="Ein Bild vor"
        >
          |▶
        </button>
        <button
          type="button"
          className="iconbutton"
          data-mobil="aus"
          onClick={() => shuttle(1)}
          disabled={!hasProxy}
          title="Vorwärts (L)"
          aria-label="Vorwärts"
        >
          ▶▶
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

        <div className="shell__spacer" />

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
          title="Stumm (M)"
          aria-label="Stummschalten"
          data-active={muted}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button
          type="button"
          className="iconbutton"
          onClick={() => void toggleFullscreen(containerRef.current, videoRef.current)}
          disabled={!hasProxy}
          title="Vollbild (F)"
          aria-label="Vollbild"
        >
          ⛶
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
              ? 'Zeichnungen beim Abspielen und Scrubben ausblenden'
              : 'Zeichnungen beim Abspielen und Scrubben einblenden'
          }
          aria-label="Zeichnungen beim Abspielen und Scrubben"
          aria-pressed={zeichnungBeiFahrt}
          data-active={zeichnungBeiFahrt}
        >
          <Icon name={zeichnungBeiFahrt ? 'eye' : 'eye-off'} />
        </button>
        <button
          type="button"
          className="iconbutton"
          onClick={() => (drawingMode ? finishDrawing() : startDrawing())}
          disabled={!hasProxy || !canComment}
          title="Auf das Bild zeichnen (D)"
          aria-label="Zeichnen"
          data-active={drawingMode}
        >
          ✎
        </button>
        <button
          type="button"
          className="iconbutton"
          onClick={requestComment}
          disabled={!hasProxy || !canComment}
          title="Kommentar am aktuellen Bild (C)"
          aria-label="Kommentar am aktuellen Bild setzen"
        >
          <Icon name="comment" />
        </button>
      </div>

      {/* Nur im Vollbild gemountet – sonst rendert das die Kommentarspalte
          doppelt, einmal hier und einmal in der Seitenleiste der Review-Seite. */}
      {fullscreenPanel && isFullscreen ? (
        <div className="player__panel" data-open={panelOpen}>
          <div className="player__panel-header">
            <span className="player__panel-title">Kommentare</span>
            <button
              type="button"
              className="iconbutton"
              onClick={() => setPanelOpen(false)}
              aria-label="Kommentarspalte schließen"
              title="Schließen"
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

/**
 * Vollbild – mit eigenem Weg für iPhone und iPad.
 *
 * Dort kennt Safari `requestFullscreen()` auf einem `div` nicht; nur das
 * `video`-Element selbst kann über `webkitEnterFullscreen()` groß werden.
 * Das kostet zwar die eigenen Leisten (iOS zeigt seine eigenen), ist aber der
 * einzige Weg, auf dem der Knopf dort überhaupt etwas tut – vorher blieb er
 * wirkungslos.
 */
async function toggleFullscreen(
  element: HTMLElement | null,
  video: HTMLVideoElement | null,
): Promise<void> {
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => undefined);
    return;
  }
  if (element?.requestFullscreen) {
    await element.requestFullscreen().catch(() => undefined);
    return;
  }
  const iosVideo = video as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
  iosVideo?.webkitEnterFullscreen?.();
}
