import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Die eigene Versionsnummer für die Anzeige unter „Über diese Software"
 * (1.5.1). Sie wird beim Bauen eingesetzt – im Browser gibt es keine
 * `package.json` zu lesen. Die Oberfläche nennt sie getrennt von der des
 * Servers: Beide werden getrennt gebaut, und wenn nur eine Hälfte erneuert
 * wurde, ist genau das die Auskunft, die man braucht.
 */
const paketVersion = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version;

/**
 * Die Web-App ist der einzige nach außen offene Dienst. Alles unter `/v1`
 * wird an die API weitergereicht – dadurch laufen Oberfläche und API unter
 * derselben Herkunft, das Sitzungs-Cookie greift ohne CORS-Ausnahmen, und
 * hinter dem Cloudflared-Tunnel muss nur ein Port veröffentlicht werden.
 */
const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_KLAPPE_VERSION: paketVersion },
  // Klappe benutzt den Bildoptimierer von Next nicht: Vorschaubilder liegen
  // hinter der Authentifizierung der API und werden als schlichtes <img>
  // eingebunden. Ausdrücklich abgeschaltet, damit der Weg über `sharp`
  // (und dessen libvips) gar nicht erst erreichbar ist.
  images: { unoptimized: true },
  // Für das schlanke Laufzeit-Image im Container.
  output: 'standalone',
  // Im Monorepo muss Next wissen, wo die Wurzel liegt, sonst fehlen im
  // Standalone-Build die Dateien aus packages/shared.
  outputFileTracingRoot: join(here, '..', '..'),
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${apiUrl}/v1/:path*` }];
  },
  /**
   * Benutzer und Gäste stehen seit Phase 17 in den Einstellungen. Die
   * Weiterleitung steht hier und nicht als Seite mit `router.replace`: So
   * greift sie schon in der Antwort des Servers, statt erst zu laden und dann
   * weiterzuspringen. Dauerhaft (308), weil die alten Adressen nicht
   * wiederkommen.
   */
  async redirects() {
    return [
      { source: '/benutzer', destination: '/einstellungen', permanent: true },
      { source: '/gaeste', destination: '/einstellungen', permanent: true },
    ];
  },
};

export default nextConfig;
