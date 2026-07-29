/**
 * Download-Formate (Phase 19): aus einem Preset und der Quellauflösung wird
 * der Auftrag für ffmpeg. Reine Rechnerei, damit sie ohne laufendes ffmpeg
 * prüfbar ist.
 */
import { planProxyScale } from './media-plan';

/** x264-Presets, langsamste zuletzt. Langsamer heißt kleiner bei gleichem Bild. */
export const X264_PRESETS = [
  'ultrafast',
  'superfast',
  'veryfast',
  'faster',
  'fast',
  'medium',
  'slow',
  'slower',
  'veryslow',
] as const;
export type X264Preset = (typeof X264_PRESETS)[number];

/**
 * Container zur Auswahl. Beides trägt H.264 + AAC; `mov` nur, weil manche
 * Schnittprogramme lieber ein `.mov` sehen – am Inhalt ändert es nichts.
 */
export const RENDITION_CONTAINERS = ['mp4', 'mov'] as const;
export type RenditionContainer = (typeof RENDITION_CONTAINERS)[number];

export function isX264Preset(value: string): value is X264Preset {
  return (X264_PRESETS as readonly string[]).includes(value);
}

export function isRenditionContainer(value: string): value is RenditionContainer {
  return (RENDITION_CONTAINERS as readonly string[]).includes(value);
}

/** Die Werte eines Presets, soweit sie das Ergebnis bestimmen. */
export interface RenditionPresetValues {
  shortEdge: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  preset: string;
  container: string;
}

/**
 * Unterschrift der Werte, mit denen eine Datei entstanden ist.
 *
 * Ändert der Admin ein Preset, passt sie nicht mehr zur abgelegten Fassung –
 * die wird dann neu erzeugt, statt still eine Datei auszuliefern, die mit dem
 * gewählten Format nichts mehr zu tun hat. Die führende Ziffer ist die
 * Fassung des Verfahrens: Wenn sich hier je die Kodierung ändert, macht ein
 * Hochzählen alle alten Dateien auf einen Schlag ungültig.
 */
export function renditionSignature(werte: RenditionPresetValues): string {
  return [
    'v1',
    Math.round(werte.shortEdge),
    Math.round(werte.videoBitrateKbps),
    Math.round(werte.audioBitrateKbps),
    werte.preset,
    werte.container,
  ].join('|');
}

export interface RenditionPlan {
  width: number;
  height: number;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  preset: string;
  container: string;
  /** `false`, wenn die Quelle schon kleiner war als das Ziel. */
  scaled: boolean;
}

/**
 * Wie groß wird die Datei und mit welcher Bitrate?
 *
 * Vergrößert wird nie – ein 720p-Original bleibt bei einem 1080p-Preset ein
 * 720p-Video. Dann sinkt auch die Bitrate mit: Ein 720p-Bild mit den 10 Mbit/s
 * eines 1080p-Presets zu kodieren macht die Datei doppelt so groß, ohne dass
 * ein Bild besser wird. Gerechnet wird über das Verhältnis der Bildfläche,
 * nach unten aber nur bis auf ein Viertel – darunter fängt es an zu bröseln.
 */
export function planRendition(
  sourceWidth: number,
  sourceHeight: number,
  werte: RenditionPresetValues,
): RenditionPlan {
  const scale = planProxyScale(sourceWidth, sourceHeight, werte.shortEdge);
  const genutzteKante = Math.min(scale.width, scale.height);
  const verhaeltnis = Math.min(1, genutzteKante / werte.shortEdge);
  const faktor = Math.max(0.25, verhaeltnis * verhaeltnis);

  return {
    width: scale.width,
    height: scale.height,
    videoBitrateKbps: Math.max(100, Math.round(werte.videoBitrateKbps * faktor)),
    audioBitrateKbps: Math.max(32, Math.round(werte.audioBitrateKbps)),
    preset: isX264Preset(werte.preset) ? werte.preset : 'veryfast',
    container: isRenditionContainer(werte.container) ? werte.container : 'mp4',
    scaled: scale.scaled,
  };
}
