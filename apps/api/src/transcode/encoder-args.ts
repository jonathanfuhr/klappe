/**
 * Encoder-Argumente: Software (libx264) oder Apple-Hardware (VideoToolbox).
 *
 * Womit kodiert wird, entscheidet der Rechner, auf dem der Worker läuft – und
 * nicht die Installation. Deshalb hängt die Wahl an der Umgebungsvariable
 * `VIDEO_ENCODER` und taucht bewusst nicht in den Einstellungen der
 * Oberfläche auf: `h264_videotoolbox` gibt es nur für einen nativ auf macOS
 * laufenden Worker; im Linux-Container eines Docker Desktop existiert
 * VideoToolbox schlicht nicht. Siehe docs/apple-silicon.md.
 *
 * Reine Rechnerei ohne Nest-Abhängigkeiten, damit sie – wie die Plan-Module –
 * ohne laufendes ffmpeg prüfbar ist. Die libx264-Ausgaben müssen wortgleich
 * zu den früheren Literalen im `FfmpegService` bleiben; darauf stehen Tests.
 *
 * Warum die VideoToolbox-Argumente so aussehen, wie sie aussehen:
 * - `-preset`, `-sc_threshold` und `-keyint_min` sind x264-Vokabular und
 *   entfallen; vtenc kennt sie nicht.
 * - `-b:v`/`-maxrate`/`-bufsize` versteht vtenc (AverageBitRate bzw.
 *   DataRateLimits) – ein weicher Deckel statt des strikten VBV von x264,
 *   für Abspielfassungen und HLS-Stufen ausreichend. So bleiben die
 *   geplanten Bitraten und die BANDWIDTH-Werte im Master-Playlist gültig.
 * - `-profile:v high` wird auch bei VideoToolbox gesetzt (in der Leiter je
 *   Stufe), damit die feste Codec-Angabe `avc1.640028` im Master-Playlist
 *   ehrlich bleibt.
 * - `-allow_sw 1`: Geht keine weitere Hardware-Session mehr auf, rechnet
 *   Apples Software-Encoder weiter, statt den Auftrag abzubrechen.
 */

export const VIDEO_ENCODERS = ['libx264', 'h264_videotoolbox'] as const;
export type VideoEncoder = (typeof VIDEO_ENCODERS)[number];

export function isVideoEncoder(value: string): value is VideoEncoder {
  return (VIDEO_ENCODERS as readonly string[]).includes(value);
}

/**
 * Argumente **vor** `-i`: Hardware-Decode über VideoToolbox.
 *
 * Ohne `-hwaccel_output_format` holt ffmpeg die dekodierten Bilder zurück in
 * den Systemspeicher – die bestehenden scale-/split-Filtergraphen bleiben
 * dadurch unverändert gültig. Kann VideoToolbox einen Quell-Codec nicht,
 * fällt ffmpeg von allein auf Software-Decode zurück (Warnung in stderr),
 * der Auftrag läuft weiter. An der Frame-Anzahl ändert der Decode-Weg
 * nichts; Frame-Genauigkeit sichern weiterhin `-fps_mode cfr` und `-r`.
 */
export function decodeArgs(encoder: VideoEncoder): string[] {
  return encoder === 'h264_videotoolbox' ? ['-hwaccel', 'videotoolbox'] : [];
}

export interface VideoEncodeParams {
  /** x264-Preset aus den Einstellungen; bei VideoToolbox ohne Bedeutung. */
  preset: string;
  /** `10M`, `8000k` oder nackte Bit je Sekunde – ffmpeg versteht alle drei. */
  videoBitrate: string;
  maxrate: string;
  bufsize: string;
  /** HLS-Leiter: Argumente je Ausgabestrom (`-c:v:0 …`) statt global (`-c:v …`). */
  streamIndex?: number;
}

/** Codec-, Profil- und Bitratenargumente für einen Videostrom. */
export function videoEncodeArgs(encoder: VideoEncoder, params: VideoEncodeParams): string[] {
  const { preset, videoBitrate, maxrate, bufsize, streamIndex } = params;

  if (streamIndex === undefined) {
    if (encoder === 'h264_videotoolbox') {
      return [
        '-c:v',
        'h264_videotoolbox',
        '-profile:v',
        'high',
        '-allow_sw',
        '1',
        '-b:v',
        videoBitrate,
        '-maxrate',
        maxrate,
        '-bufsize',
        bufsize,
      ];
    }
    return [
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-preset',
      preset,
      '-b:v',
      videoBitrate,
      '-maxrate',
      maxrate,
      '-bufsize',
      bufsize,
    ];
  }

  const i = streamIndex;
  if (encoder === 'h264_videotoolbox') {
    return [
      `-c:v:${i}`,
      'h264_videotoolbox',
      `-profile:v:${i}`,
      'high',
      `-allow_sw:v:${i}`,
      '1',
      `-b:v:${i}`,
      videoBitrate,
      `-maxrate:v:${i}`,
      maxrate,
      `-bufsize:v:${i}`,
      bufsize,
    ];
  }
  // Reihenfolge wie eh und je: In der Leiter stand das Preset schon immer
  // hinten – die Tests vergleichen wortgleich.
  return [
    `-c:v:${i}`,
    'libx264',
    `-b:v:${i}`,
    videoBitrate,
    `-maxrate:v:${i}`,
    maxrate,
    `-bufsize:v:${i}`,
    bufsize,
    `-preset:v:${i}`,
    preset,
  ];
}

/**
 * Schlüsselbild-Argumente der HLS-Leiter: exakt ein Keyframe je
 * Segmentanfang, sonst kann der Player nicht sauber zwischen den Stufen
 * wechseln. x264 braucht dafür drei Angaben (festes GOP, Scene-Cut aus);
 * VideoToolbox genügt `-g` – das mappt auf das größte Keyframe-Intervall,
 * und Scene-Cut-Keyframes setzt der Encoder von sich aus keine.
 */
export function keyframeArgs(encoder: VideoEncoder, gopFrames: number): string[] {
  const gop = String(gopFrames);
  if (encoder === 'h264_videotoolbox') {
    return ['-g', gop];
  }
  return ['-g', gop, '-keyint_min', gop, '-sc_threshold', '0'];
}
