import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { UploadPanel } from '@/components/UploadPanel';
import { BrandingProvider } from '@/lib/branding';
import { SessionProvider } from '@/lib/session';
import { UploadsProvider } from '@/lib/uploads-context';
import './globals.css';

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
