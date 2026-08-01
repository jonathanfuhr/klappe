import type { BrandingDto } from '@klappe/shared';
import { DEFAULT_BRAND_ACCENT, DEFAULT_BRAND_TITLE } from '@klappe/shared';
import { APP_ICON_SIZE, DEFAULT_LOCALE, isLocale } from '@klappe/shared';

/**
 * Der Untertitel der App-Kachel in beiden Sprachen (Phase 26). Ein Manifest
 * wird ohne Sitzung geholt – hier zählt deshalb die Vorgabe des Workspace und
 * nicht die persönliche Wahl.
 */
const BESCHREIBUNG: Record<string, string> = {
  de: 'Review und Freigabe für Videoproduktionen',
  en: 'Review and approval for video production',
};

/**
 * Das Web-App-Manifest (Phase 24).
 *
 * „Zum Home-Bildschirm" auf einem iPhone macht daraus eine App-Kachel mit
 * eigenem Namen und Symbol statt eines Lesezeichens mit Bildschirmausschnitt.
 * Titel und Farbe kommen aus dem Erscheinungsbild des Workspace, das Symbol
 * ist das gerasterte PNG – deshalb eine Route und keine statische Datei.
 *
 * Die API wird serverseitig gefragt, über dieselbe Adresse, die auch die
 * Weiterleitung in `next.config.mjs` benutzt.
 */
const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

/** Nicht vorrendern: Das Erscheinungsbild ändert sich zur Laufzeit. */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  let branding: BrandingDto | null = null;
  try {
    const antwort = await fetch(`${apiUrl}/v1/branding`, { cache: 'no-store' });
    if (antwort.ok) branding = (await antwort.json()) as BrandingDto;
  } catch {
    // Ohne Antwort gilt der Standard – ein Manifest, das der Browser nicht
    // lesen kann, wäre schlechter als eines ohne eigenes Symbol.
  }

  const titel = branding?.title ?? DEFAULT_BRAND_TITLE;
  const sprache = isLocale(branding?.defaultLocale) ? branding.defaultLocale : DEFAULT_LOCALE;

  return Response.json(
    {
      name: titel,
      short_name: titel,
      description: BESCHREIBUNG[sprache] ?? BESCHREIBUNG.de,
      start_url: '/projekte',
      scope: '/',
      display: 'standalone',
      background_color: '#0e1013',
      theme_color: branding?.accent ?? DEFAULT_BRAND_ACCENT,
      lang: sprache,
      icons: branding?.appIconUrl
        ? [
            {
              src: branding.appIconUrl,
              sizes: `${APP_ICON_SIZE}x${APP_ICON_SIZE}`,
              type: 'image/png',
              // `any`: Das Symbol bringt seinen eigenen Rand mit und soll nicht
              // noch einmal in eine Maske geschnitten werden.
              purpose: 'any',
            },
          ]
        : [],
    },
    {
      headers: {
        'Content-Type': 'application/manifest+json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    },
  );
}
