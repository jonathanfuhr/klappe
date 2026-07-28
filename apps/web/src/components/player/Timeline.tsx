'use client';

import {
  type VersionDto,
  formatDuration,
  frameToDisplayTimecode,
  framesToSeconds,
} from '@klappe/shared';
import { type PointerEvent as ReactPointerEvent, useCallback, useMemo, useRef, useState } from 'react';
import { mediaUrl } from '@/lib/api';
import type { CommentMarker } from './VideoPlayer';

interface TimelineProps {
  version: VersionDto;
  frame: number;
  totalFrames: number;
  durationSeconds: number;
  bufferedFraction: number;
  markers: CommentMarker[];
  activeCommentId?: string | null;
  disabled?: boolean;
  onSeekFrame: (frame: number) => void;
  onMarkerClick?: (commentId: string) => void;
}

/**
 * Scrub-Leiste mit Kommentar-Markern und Sprite-Vorschau.
 *
 * Gerechnet wird durchgehend in Frames: Position und Sprungziel ergeben sich
 * aus dem Frame-Index, nicht aus Sekunden – sonst landet ein Klick je nach
 * Rundung im Nachbarbild.
 */
export function Timeline({
  version,
  frame,
  totalFrames,
  durationSeconds,
  bufferedFraction,
  markers,
  activeCommentId,
  disabled,
  onSeekFrame,
  onMarkerClick,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ fraction: number; frame: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const frameRate = version.media.frameRate;
  const lastFrame = Math.max(0, totalFrames - 1);

  const timecodeContext = useMemo(
    () => ({
      fps: frameRate ?? { num: 25, den: 1 },
      dropFrame: version.media.dropFrame,
      startFrames: version.media.startTimecodeFrames,
    }),
    [frameRate, version.media.dropFrame, version.media.startTimecodeFrames],
  );

  const fractionOf = useCallback(
    (value: number) => (lastFrame > 0 ? Math.max(0, Math.min(1, value / lastFrame)) : 0),
    [lastFrame],
  );

  const frameFromEvent = useCallback(
    (clientX: number): { fraction: number; frame: number } | null => {
      const track = trackRef.current;
      if (!track || lastFrame <= 0) return null;
      const rect = track.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return { fraction, frame: Math.round(fraction * lastFrame) };
    },
    [lastFrame],
  );

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const position = frameFromEvent(event.clientX);
    if (!position) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setScrubbing(true);
    onSeekFrame(position.frame);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const position = frameFromEvent(event.clientX);
    if (!position) return;
    setHover(position);
    if (scrubbing) onSeekFrame(position.frame);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubbing) {
      event.currentTarget.releasePointerCapture(event.pointerId);
      setScrubbing(false);
    }
  };

  const sprite = version.sprite;
  const previewTile = useMemo(() => {
    if (!sprite || !hover || durationSeconds <= 0) return null;
    const seconds = frameRate ? framesToSeconds(hover.frame, frameRate) : hover.fraction * durationSeconds;
    const index = Math.max(0, Math.min(sprite.tileCount - 1, Math.floor(seconds / sprite.intervalSeconds)));
    const column = index % sprite.columns;
    const row = Math.floor(index / sprite.columns);
    return {
      width: sprite.tileWidth,
      height: sprite.tileHeight,
      backgroundImage: `url(${mediaUrl.sprite(version.id)})`,
      backgroundSize: `${sprite.columns * sprite.tileWidth}px ${sprite.rows * sprite.tileHeight}px`,
      backgroundPosition: `-${column * sprite.tileWidth}px -${row * sprite.tileHeight}px`,
    };
  }, [sprite, hover, durationSeconds, frameRate, version.id]);

  return (
    <div className="timeline">
      <div
        className="timeline__track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        role="slider"
        aria-label="Abspielposition"
        aria-valuemin={0}
        aria-valuemax={lastFrame}
        aria-valuenow={frame}
        aria-valuetext={frameRate ? frameToDisplayTimecode(frame, timecodeContext) : undefined}
        tabIndex={disabled ? -1 : 0}
      >
        <div className="timeline__rail" />
        <div className="timeline__buffered" style={{ width: `${bufferedFraction * 100}%` }} />
        <div className="timeline__played" style={{ width: `${fractionOf(frame) * 100}%` }} />
        <div className="timeline__playhead" style={{ left: `${fractionOf(frame) * 100}%` }} />

        {markers.map((marker) => (
          <button
            key={marker.id}
            type="button"
            className="timeline__marker"
            data-resolved={marker.resolved}
            style={{ left: `${fractionOf(marker.frame) * 100}%` }}
            title={marker.label}
            aria-label={marker.label}
            data-active={marker.id === activeCommentId}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onMarkerClick?.(marker.id);
            }}
          />
        ))}
      </div>

      {hover && !disabled ? (
        <div className="timeline__preview" style={{ left: `${hover.fraction * 100}%` }}>
          {previewTile ? (
            <div
              className="timeline__preview-image"
              style={{
                width: previewTile.width,
                height: previewTile.height,
                backgroundImage: previewTile.backgroundImage,
                backgroundSize: previewTile.backgroundSize,
                backgroundPosition: previewTile.backgroundPosition,
              }}
            />
          ) : null}
          <div className="timeline__preview-label mono">
            {frameRate ? frameToDisplayTimecode(hover.frame, timecodeContext) : '--:--:--:--'}
          </div>
        </div>
      ) : null}

      <div className="timeline__scale mono">
        <span>{frameRate ? frameToDisplayTimecode(0, timecodeContext) : '00:00:00:00'}</span>
        <span>
          {version.media.frameCount
            ? `${version.media.frameCount} Frames`
            : formatDuration(durationSeconds)}
        </span>
        <span>
          {frameRate
            ? frameToDisplayTimecode(lastFrame, timecodeContext)
            : formatDuration(durationSeconds)}
        </span>
      </div>
    </div>
  );
}
