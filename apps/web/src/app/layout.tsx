import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { UploadPanel } from '@/components/UploadPanel';
import { BrandingProvider } from '@/lib/branding';
import { I18nProvider } from '@/lib/i18n';
import { LiveProvider } from '@/lib/live';
import { SessionProvider } from '@/lib/session';
import { UploadsProvider } from '@/lib/uploads-context';
import './globals.css';

/**
 * `viewport-fit: cover` lässt den Player bis in die Ecken eines Geräts mit
 * Aussparung reichen; ohne die Angabe bleiben dort schwarze Balken (Phase 17).
 * `maximumScale` bleibt offen – Zoom zu verbieten nimmt Menschen mit
 * eingeschränktem Sehen ein Werkzeug weg.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0b0d11',
};

export const metadata: Metadata = {
  title: 'Klappe',
  description: 'Review und Freigabe für Videoproduktionen',
  /**
   * Das Manifest wird zur Laufzeit gebaut (Phase 24): Name, Farbe und Symbol
   * stammen aus dem Erscheinungsbild des Workspace. Erst damit legt ein iPhone
   * beim „Zum Home-Bildschirm" eine App-Kachel mit eigenem Symbol an statt
   * eines Lesezeichens mit Bildschirmausschnitt.
   */
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Klappe' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        {/* Farben und Titel des Workspace gelten überall, auch auf der
            Anmeldeseite – deshalb ganz außen. */}
        <BrandingProvider>
          <SessionProvider>
            {/* Sprache steht erst fest, wenn Erscheinungsbild und Sitzung da
                sind (Phase 26) – deshalb innerhalb beider. */}
            <I18nProvider>
            {/* Eine Live-Verbindung für die ganze Anwendung (Phase 18):
                Was sich ändert, kommt von selbst an, statt im Sekundentakt
                erfragt zu werden. */}
            <LiveProvider>
              {/* Die Warteschlange liegt im Wurzel-Layout, damit Uploads beim
                  Wechsel zwischen Projekten weiterlaufen. */}
              <UploadsProvider>
                {children}
                <UploadPanel />
              </UploadsProvider>
            </LiveProvider>
            </I18nProvider>
          </SessionProvider>
        </BrandingProvider>
      </body>
    </html>
  );
}
