'use client';

import { useBranding } from '@/lib/branding';

/**
 * Logo und Titel des Workspace (Phase 10).
 *
 * Steht auf der Anmeldeseite, im Gast-Gatter und in der Abmeldebestätigung –
 * überall dort, wo noch keine Sitzung existiert, das Erscheinungsbild aber
 * schon stimmen soll. Ohne hinterlegtes Logo bleibt es beim Zeichen.
 */
export function BrandMark({ className = 'login__brand' }: { className?: string }) {
  const { branding } = useBranding();

  return (
    <div className={className}>
      {branding.logoUrl ? (
        // Bewusst als <img>: Ein hochgeladenes SVG könnte Skripte enthalten,
        // die auf diesem Weg nicht ausgeführt werden.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="shell__brand-logo" src={branding.logoUrl} alt={branding.title} />
      ) : (
        <span className="shell__brand-mark" aria-hidden>
          ◗
        </span>
      )}
      {branding.title}
    </div>
  );
}
