/**
 * Timecode- und Frame-Mathematik.
 *
 * Diese Datei ist die einzige Quelle der Wahrheit für die Umrechnung zwischen
 * Frames, Sekunden und SMPTE-Timecode – sie wird von der API, dem Worker und
 * dem Player im Browser gemeinsam benutzt. Alles, was am Video frame-genau
 * sein muss (Counter, Kommentar-Position, Sprungmarken), rechnet hierüber.
 *
 * Grundsatz: Die kanonische Einheit ist der **Frame-Index** (0 = erstes Bild
 * des Videos). Sekunden sind nur Darstellung fürs `<video>`-Element, Timecode
 * nur Darstellung für Menschen.
 */

/** Framerate als exakter Bruch, z. B. 30000/1001 für 29,97. */
export interface FrameRate {
  num: number;
  den: number;
}

/** Toleranz gegen Fließkomma-Rauschen bei der Frame-Bestimmung. */
const EPSILON = 1e-6;

export const FPS_25: FrameRate = { num: 25, den: 1 };
export const FPS_2997: FrameRate = { num: 30000, den: 1001 };

export function makeFrameRate(num: number, den: number): FrameRate {
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) {
    throw new RangeError(`Ungültige Framerate: ${num}/${den}`);
  }
  return { num, den };
}

/** `"30000/1001"`, `"25"` oder `"29.97"` → Bruch. Gibt `null` bei Unsinn zurück. */
export function parseFrameRate(value: string | null | undefined): FrameRate | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const fraction = trimmed.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const num = Number(fraction[1]);
    const den = Number(fraction[2]);
    if (num > 0 && den > 0) return { num, den };
    return null;
  }

  const decimal = Number(trimmed);
  if (!Number.isFinite(decimal) || decimal <= 0) return null;

  // Kamera-Frameraten wie 23.976/29.97/59.94 sind gerundete Schreibweisen der
  // 1000/1001-Raten. Wir stellen den exakten Bruch wieder her.
  const ntsc = [24, 30, 60, 120].find((base) => Math.abs(decimal - (base * 1000) / 1001) < 0.005);
  if (ntsc) return { num: ntsc * 1000, den: 1001 };

  if (Number.isInteger(decimal)) return { num: decimal, den: 1 };
  return { num: Math.round(decimal * 1000), den: 1000 };
}

/** Framerate als Dezimalzahl, z. B. 29.97002997. */
export function fpsToNumber(fps: FrameRate): number {
  return fps.num / fps.den;
}

/**
 * Nominelle Framerate für die Timecode-Zählung: 29,97 zählt in 30er-Schritten,
 * 23,976 in 24er-Schritten. Genau dafür gibt es Drop-Frame.
 */
export function nominalFps(fps: FrameRate): number {
  return Math.round(fpsToNumber(fps));
}

/** Drop-Frame ist nur für die NTSC-Raten 29,97 und 59,94 definiert. */
export function supportsDropFrame(fps: FrameRate): boolean {
  const nominal = nominalFps(fps);
  if (nominal !== 30 && nominal !== 60) return false;
  return Math.abs(fpsToNumber(fps) - nominal) > 0.001;
}

/** Anzahl übersprungener Frame-Nummern pro Minute (2 bei 29,97, 4 bei 59,94). */
function dropFramesPerMinute(fps: FrameRate): number {
  return Math.round(nominalFps(fps) * 0.066666);
}

function formatPart(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, '0');
}

/**
 * Frame-Index → SMPTE-Timecode `HH:MM:SS:FF` (Non-Drop) bzw. `HH:MM:SS;FF`
 * (Drop-Frame). Negative Frames werden mit führendem `-` dargestellt.
 */
export function framesToTimecode(frames: number, fps: FrameRate, dropFrame = false): string {
  const negative = frames < 0;
  let frameNumber = Math.abs(Math.round(frames));
  const nominal = nominalFps(fps);
  const useDropFrame = dropFrame && supportsDropFrame(fps);

  if (useDropFrame) {
    const drop = dropFramesPerMinute(fps);
    const framesPerMinute = nominal * 60 - drop;
    const framesPer10Minutes = nominal * 600 - 9 * drop;
    const tenMinuteBlocks = Math.floor(frameNumber / framesPer10Minutes);
    const rest = frameNumber % framesPer10Minutes;

    frameNumber += drop * 9 * tenMinuteBlocks;
    if (rest > drop) {
      frameNumber += drop * Math.floor((rest - drop) / framesPerMinute);
    }
  }

  const ff = frameNumber % nominal;
  const ss = Math.floor(frameNumber / nominal) % 60;
  const mm = Math.floor(frameNumber / (nominal * 60)) % 60;
  const hh = Math.floor(frameNumber / (nominal * 3600)) % 24;
  const separator = useDropFrame ? ';' : ':';

  return `${negative ? '-' : ''}${formatPart(hh)}:${formatPart(mm)}:${formatPart(ss)}${separator}${formatPart(ff)}`;
}

/**
 * SMPTE-Timecode → Frame-Index. Akzeptiert `HH:MM:SS:FF`, `HH:MM:SS;FF` und
 * die Kurzform `MM:SS:FF`. Ein `;` im String erzwingt Drop-Frame, sofern die
 * Framerate das hergibt.
 */
export function timecodeToFrames(timecode: string, fps: FrameRate, dropFrame?: boolean): number {
  const trimmed = timecode.trim();
  const match = trimmed.match(/^(-)?(?:(\d+):)?(\d{1,2}):(\d{1,2})([:;.])(\d{1,3})$/);
  if (!match) {
    throw new SyntaxError(`Ungültiger Timecode: "${timecode}"`);
  }

  const negative = match[1] === '-';
  const hours = match[2] ? Number(match[2]) : 0;
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  const frames = Number(match[6]);
  const nominal = nominalFps(fps);

  if (minutes > 59 || seconds > 59 || frames >= nominal) {
    throw new RangeError(`Timecode außerhalb des gültigen Bereichs: "${timecode}"`);
  }

  const explicitDropFrame = match[5] === ';';
  const useDropFrame = (dropFrame ?? explicitDropFrame) && supportsDropFrame(fps);

  let total = ((hours * 60 + minutes) * 60 + seconds) * nominal + frames;
  if (useDropFrame) {
    const drop = dropFramesPerMinute(fps);
    const totalMinutes = hours * 60 + minutes;
    total -= drop * (totalMinutes - Math.floor(totalMinutes / 10));
  }

  return negative ? -total : total;
}

/** Frame-Index → exakter Startzeitpunkt des Frames in Sekunden. */
export function framesToSeconds(frames: number, fps: FrameRate): number {
  return (frames * fps.den) / fps.num;
}

/**
 * Zeitpunkt in Sekunden → Frame-Index, also das Bild, das zu diesem Zeitpunkt
 * auf dem Schirm steht. `+EPSILON` fängt ab, dass ein exakter Frame-Anfang
 * durch Fließkomma-Rauschen als Vorgänger-Frame gelesen wird.
 */
export function secondsToFrames(seconds: number, fps: FrameRate): number {
  if (!Number.isFinite(seconds)) return 0;
  return Math.max(0, Math.floor((seconds * fps.num) / fps.den + EPSILON));
}

/**
 * Zielzeit fürs Springen auf einen Frame. Wir zielen bewusst auf die *Mitte*
 * des Frames: Browser runden `currentTime` unterschiedlich, mittig gesetzt
 * landet der Player zuverlässig im gewünschten Bild und nicht im Nachbarn.
 */
export function frameToSeekTime(frame: number, fps: FrameRate): number {
  const safeFrame = Math.max(0, Math.round(frame));
  return ((safeFrame + 0.5) * fps.den) / fps.num;
}

/** Dauer in Sekunden → Anzahl Frames (aufgerundet, mindestens 1 bei Inhalt). */
export function durationToFrameCount(durationSeconds: number, fps: FrameRate): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return Math.max(1, Math.round((durationSeconds * fps.num) / fps.den));
}

/** `H:MM:SS` bzw. `MM:SS` für Laufzeitangaben ohne Frame-Anteil. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hh = Math.floor(total / 3600);
  const mm = Math.floor(total / 60) % 60;
  const ss = total % 60;
  return hh > 0
    ? `${hh}:${formatPart(mm)}:${formatPart(ss)}`
    : `${mm}:${formatPart(ss)}`;
}

/** Beschreibt, wie ein konkretes Video gezählt wird. */
export interface TimecodeContext {
  fps: FrameRate;
  dropFrame: boolean;
  /** Start-Timecode des Originals in Frames (aus `ffprobe`), meist 0. */
  startFrames: number;
}

/**
 * Frame-Index im Video → angezeigter Timecode des Originalmaterials.
 * Der Start-Timecode der Kamera wird dabei aufaddiert, damit die Anzeige zu
 * dem passt, was der Cutter im Schnittprogramm sieht.
 */
export function frameToDisplayTimecode(frame: number, context: TimecodeContext): string {
  return framesToTimecode(context.startFrames + frame, context.fps, context.dropFrame);
}

/** Umkehrung von {@link frameToDisplayTimecode}. */
export function displayTimecodeToFrame(timecode: string, context: TimecodeContext): number {
  return timecodeToFrames(timecode, context.fps, context.dropFrame) - context.startFrames;
}
