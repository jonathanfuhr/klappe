'use client';

import { type FrameRate, secondsToFrames } from '@klappe/shared';
import { type RefObject, useEffect, useState } from 'react';

/**
 * Liefert den gerade sichtbaren Frame-Index – live, während das Video läuft.
 *
 * Bevorzugt wird `requestVideoFrameCallback`: Der Browser meldet damit zu
 * jedem tatsächlich dargestellten Bild dessen exakte `mediaTime`. Das ist der
 * einzige Weg zu einem Counter, der wirklich zum Bild passt; `timeupdate`
 * feuert nur alle ~250 ms und `currentTime` in einer rAF-Schleife hinkt dem
 * dargestellten Bild hinterher.
 *
 * Firefox kennt `requestVideoFrameCallback` (Stand 2026) nicht – dort läuft
 * ersatzweise eine rAF-Schleife über `currentTime`.
 */
export function useFrameClock(
  videoRef: RefObject<HTMLVideoElement | null>,
  frameRate: FrameRate | null,
  ready: boolean,
): number {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !frameRate || !ready) return;

    let cancelled = false;
    let rafHandle = 0;
    let videoFrameHandle = 0;

    const update = (seconds: number) => {
      if (cancelled) return;
      setFrame(secondsToFrames(seconds, frameRate));
    };

    const requestVideoFrame = video.requestVideoFrameCallback?.bind(video);
    const cancelVideoFrame = video.cancelVideoFrameCallback?.bind(video);

    if (requestVideoFrame) {
      const onVideoFrame: VideoFrameRequestCallback = (_now, metadata) => {
        update(metadata.mediaTime);
        if (!cancelled) {
          videoFrameHandle = requestVideoFrame(onVideoFrame);
        }
      };
      videoFrameHandle = requestVideoFrame(onVideoFrame);
    } else {
      const tick = () => {
        update(video.currentTime);
        if (!cancelled) rafHandle = requestAnimationFrame(tick);
      };
      rafHandle = requestAnimationFrame(tick);
    }

    // Beim Springen im pausierten Zustand meldet sich der Frame-Callback nur
    // einmal – diese Ereignisse halten die Anzeige trotzdem aktuell.
    const onSync = () => update(video.currentTime);
    video.addEventListener('seeked', onSync);
    video.addEventListener('timeupdate', onSync);
    video.addEventListener('loadedmetadata', onSync);

    onSync();

    return () => {
      cancelled = true;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      if (videoFrameHandle && cancelVideoFrame) cancelVideoFrame(videoFrameHandle);
      video.removeEventListener('seeked', onSync);
      video.removeEventListener('timeupdate', onSync);
      video.removeEventListener('loadedmetadata', onSync);
    };
  }, [videoRef, frameRate, ready]);

  return frame;
}
