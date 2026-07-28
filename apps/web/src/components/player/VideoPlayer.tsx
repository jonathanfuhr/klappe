'use client';

import {
  type FrameRate,
  type VersionDto,
  formatDuration,
  frameToDisplayTimecode,
  frameToSeekTime,
  framesToSeconds,
} from '@klappe/shared';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { mediaUrl } from '@/lib/api';
import { Timeline } from './Timeline';
import { useFrameClock } from './useFrameClock';

export interface PlayerHandle {
  seekToFrame: (frame: number) => void;
  getFrame: () => number;
  pause: () => void;
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
  onMarkerClick?: (commentId: string) => void;
  onFrameChange?: (frame: number) => void;
  onRequestComment?: (frame: number) => void;
}

/** Stufen für J/K/L – wie im Schnittprogramm. */
const SHUTTLE_RATES = [1, 2, 4, 8] as const;

export const VideoPlayer = forwardRef<PlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { version, markers, activeCommentId, onMarkerClick, onFrameChange, onRequestComment },
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

  useImperativeHandle(
    ref,
    () => ({
      seekToFrame: (target: number) => {
        stopTransport();
        seekToFrame(target);
      },
      getFrame: () => frame,
      pause: stopTransport,
    }),
    [frame, seekToFrame, stopTransport],
  );

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
          void toggleFullscreen(containerRef.current);
          break;
        case 'c':
        case 'C':
          event.preventDefault();
          stopTransport();
          onRequestComment?.(frame);
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    frame,
    frameRate,
    onRequestComment,
    shuttle,
    stepFrames,
    stopTransport,
    togglePlay,
    totalFrames,
  ]);

  const durationSeconds = version.media.durationSeconds ?? 0;
  const hasProxy = version.hasProxy && version.status === 'READY';

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
            src={mediaUrl.proxy(version.id)}
            poster={version.hasPoster ? mediaUrl.poster(version.id) : undefined}
            preload="auto"
            playsInline
            onLoadedMetadata={() => setReady(true)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setRate(0)}
            onProgress={onProgress}
            onClick={togglePlay}
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
      </div>

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
        }}
        onMarkerClick={onMarkerClick}
      />

      <div className="player__controls">
        <button
          type="button"
          className="iconbutton"
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
          onClick={() => shuttle(1)}
          disabled={!hasProxy}
          title="Vorwärts (L)"
          aria-label="Vorwärts"
        >
          ▶▶
        </button>

        <span className="player__rate mono">{rate === 0 ? '–' : `${rate > 0 ? '' : '−'}${Math.abs(rate)}×`}</span>

        <div className="player__counter">
          <span className="player__timecode mono">
            {frameRate ? frameToDisplayTimecode(frame, timecodeContext) : '--:--:--:--'}
          </span>
          <span className="player__frame mono">
            Frame {frame}
            {totalFrames > 0 ? ` / ${totalFrames - 1}` : ''}
          </span>
        </div>

        <span className="muted mono" style={{ fontSize: 12 }}>
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
          onClick={() => void toggleFullscreen(containerRef.current)}
          disabled={!hasProxy}
          title="Vollbild (F)"
          aria-label="Vollbild"
        >
          ⛶
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            stopTransport();
            onRequestComment?.(frame);
          }}
          disabled={!hasProxy}
          title="Kommentar am aktuellen Bild (C)"
        >
          Kommentar setzen
        </button>
      </div>
    </div>
  );
});

async function toggleFullscreen(element: HTMLElement | null): Promise<void> {
  if (!element) return;
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => undefined);
    return;
  }
  await element.requestFullscreen().catch(() => undefined);
}
