/**
 * `requestVideoFrameCallback` ist in den TypeScript-DOM-Typen (noch) nicht
 * enthalten. Die Deklaration folgt der W3C-Spezifikation
 * „HTMLVideoElement.requestVideoFrameCallback()“.
 */
interface VideoFrameCallbackMetadata {
  presentationTime: DOMHighResTimeStamp;
  expectedDisplayTime: DOMHighResTimeStamp;
  width: number;
  height: number;
  /** Zeitstempel des dargestellten Bildes in der Zeitbasis des Videos. */
  mediaTime: number;
  presentedFrames: number;
  processingDuration?: number;
  captureTime?: DOMHighResTimeStamp;
  receiveTime?: DOMHighResTimeStamp;
  rtpTimestamp?: number;
}

type VideoFrameRequestCallback = (
  now: DOMHighResTimeStamp,
  metadata: VideoFrameCallbackMetadata,
) => void;

interface HTMLVideoElement {
  requestVideoFrameCallback?(callback: VideoFrameRequestCallback): number;
  cancelVideoFrameCallback?(handle: number): void;
}
