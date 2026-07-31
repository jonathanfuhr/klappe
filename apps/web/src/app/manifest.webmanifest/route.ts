import type { BrandingDto } from '@klappe/shared';
import { DEFAULT_BRAND_ACCENT, DEFAULT_BRAND_TITLE } from '@klappe/shared';
import { APP_ICON_SIZE } from '@klappe/shared';

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

  return Response.json(
    {
      name: titel,
      short_name: titel,
      description: 'Review und Freigabe für Videoproduktionen',
      start_url: '/projekte',
      scope: '/',
      display: 'standalone',
      background_color: '#0e1013',
      theme_color: branding?.accent ?? DEFAULT_BRAND_ACCENT,
      lang: 'de',
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
