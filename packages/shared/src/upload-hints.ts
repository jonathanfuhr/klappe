/**
 * Vorschläge aus dem Dateinamen für das Upload-Fenster.
 *
 * Wer zwanzig Dateien auf einmal ablegt, soll nicht zwanzigmal Projekt,
 * Video und Versionsnummer von Hand setzen müssen. Alles hier sind
 * **Vorschläge** – die Oberfläche zeigt sie mit dem Hinweis, sie zu prüfen,
 * und nichts wird ungefragt übernommen.
 */

/** Endung abschneiden, ohne an Punkten im Namen hängen zu bleiben. */
function stripExtension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index > 0 && filename.length - index <= 9 ? filename.slice(0, index) : filename;
}

/**
 * Versionsnummer aus dem Dateinamen: `V1`, `v01`, `_V2_`, `Version 3`.
 *
 * Verlangt eine Grenze vor dem `v`, damit nicht mitten in einem Wort
 * gefunden wird, und keine weitere Ziffer dahinter, damit `v1080` nicht als
 * Version 1080 durchgeht.
 */
export function detectVersionNumber(filename: string): number | null {
  const matches = [...stripExtension(filename).matchAll(/(?:^|[^a-z0-9])(?:version|v)[ ._-]?(\d{1,3})(?![0-9])/gi)];
  if (matches.length === 0) return null;

  // Bei mehreren Treffern zählt der letzte – „Projekt_V1_Schnitt_V2“ meint V2.
  const value = Number.parseInt(matches[matches.length - 1][1], 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Auflösungs- und Formatschnipsel, die nicht in den Videonamen gehören. */
const NOISE = /^(\d{3,4}p\d{0,4}|4k|uhd|hd|fullhd|prores|h264|h265|final|export|master)$/i;

/** Kunde und Projekt, deren Namen nicht in den Videonamen gehören (Phase 25). */
export interface VideoNameContext {
  name?: string | null;
  customer?: string | null;
}

/**
 * Vorschlag für den Videonamen: Endung, Versionskürzel, Datumsblöcke und
 * Format-Schnipsel raus, Trennzeichen zu Leerzeichen.
 *
 * Steht das Ziel-Projekt schon fest, fliegen auch Kunden- und Projektname aus
 * dem Vorschlag (Phase 25): Der Download-Dateiname trägt beides ohnehin vor
 * dem Videonamen – aus `SDK_Firmencockpit_Imagefilm_V2.mov` würde sonst
 * `…_SDK_Firmencockpit_SDK Firmencockpit Imagefilm_v2_….mov`.
 */
export function suggestVideoName(filename: string, projekt?: VideoNameContext): string {
  const base = stripExtension(filename)
    .replace(/(?:^|[^a-z0-9])(?:version|v)[ ._-]?\d{1,3}(?![0-9])/gi, ' ')
    .replace(/(?:^|[^0-9])(\d{8}|\d{6})(?![0-9])/g, ' ')
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ');

  const words = base
    .split(/[\s._-]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0 && !NOISE.test(word));

  // Verglichen wird wortweise über dieselbe Zerlegung wie beim Projekt-Match –
  // Groß-/Kleinschreibung egal, sehr kurze Wörter bleiben stehen.
  const verboten = new Set([
    ...tokenize(projekt?.name ?? ''),
    ...tokenize(projekt?.customer ?? ''),
  ]);
  const bereinigt =
    verboten.size > 0
      ? words.filter((word) => !verboten.has(word.toLowerCase().normalize('NFC')))
      : words;

  // Besteht der Dateiname *nur* aus Kunde und Projekt, wäre der Vorschlag
  // leer – dann lieber der ungeputzte Name als gar keiner.
  const name = (bereinigt.length > 0 ? bereinigt : words).join(' ').trim();
  return name || stripExtension(filename);
}

export interface ProjectHintCandidate {
  id: string;
  name: string;
  customer: string | null;
}

export interface ProjectHint {
  projectId: string;
  /** Wie viele Anhaltspunkte gefunden wurden – höher heißt sicherer. */
  score: number;
  /** Welche Wörter gepasst haben, für den Hinweis in der Oberfläche. */
  matched: string[];
}

/** Zerlegt einen Text in vergleichbare Wörter. */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFC')
    .split(/[^a-z0-9äöüß]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

/**
 * Sucht das Projekt, zu dem ein Dateiname am ehesten gehört – über
 * Projektname und Kunde. Ein Treffer beim Kunden zählt doppelt: Wer eine
 * Datei „Beispiel_Imagefilm_V2.mov“ nennt, meint fast immer das Projekt dieses
 * Kunden.
 *
 * Gibt `null` zurück, wenn nichts eindeutig genug ist.
 */
export function matchProject(
  filename: string,
  projects: ProjectHintCandidate[],
): ProjectHint | null {
  const fileTokens = new Set(tokenize(stripExtension(filename)));
  if (fileTokens.size === 0) return null;

  let best: ProjectHint | null = null;

  for (const project of projects) {
    const matched: string[] = [];
    let score = 0;

    for (const token of new Set(tokenize(project.name))) {
      if (fileTokens.has(token)) {
        score += 1;
        matched.push(token);
      }
    }
    for (const token of new Set(tokenize(project.customer ?? ''))) {
      if (fileTokens.has(token)) {
        score += 2;
        matched.push(token);
      }
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { projectId: project.id, score, matched: [...new Set(matched)] };
    }
  }

  return best;
}

export interface VideoHintCandidate {
  id: string;
  name: string;
}

/**
 * Passt der Dateiname zu einem vorhandenen Video des Projekts? Dann ist es
 * vermutlich eine neue Fassung davon und kein neues Video.
 */
export function matchVideo(filename: string, videos: VideoHintCandidate[]): string | null {
  const fileTokens = new Set(tokenize(suggestVideoName(filename)));
  if (fileTokens.size === 0) return null;

  let bestId: string | null = null;
  let bestScore = 0;

  for (const video of videos) {
    const videoTokens = [...new Set(tokenize(video.name))];
    if (videoTokens.length === 0) continue;

    const hits = videoTokens.filter((token) => fileTokens.has(token)).length;
    // Zwei Bedingungen, damit nicht jede Datei beim erstbesten Video mit
    // einem Allerweltswort landet: Mindestens die Hälfte der Wörter muss
    // vorkommen, und das erste – meist das unterscheidende – muss dabei sein.
    if (hits === 0 || hits * 2 < videoTokens.length) continue;
    if (!fileTokens.has(videoTokens[0])) continue;

    if (hits > bestScore) {
      bestScore = hits;
      bestId = video.id;
    }
  }

  return bestId;
}
