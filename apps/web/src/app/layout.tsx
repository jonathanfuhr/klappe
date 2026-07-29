import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { UploadPanel } from '@/components/UploadPanel';
import { BrandingProvider } from '@/lib/branding';
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
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        {/* Farben und Titel des Workspace gelten überall, auch auf der
            Anmeldeseite – deshalb ganz außen. */}
        <BrandingProvider>
          <SessionProvider>
            {/* Die Warteschlange liegt im Wurzel-Layout, damit Uploads beim
                Wechsel zwischen Projekten weiterlaufen. */}
            <UploadsProvider>
              {children}
              <UploadPanel />
            </UploadsProvider>
          </SessionProvider>
        </BrandingProvider>
      </body>
    </html>
  );
}
