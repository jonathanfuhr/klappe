'use client';

import type { BrandingDto } from '@klappe/shared';
import { DEFAULT_BRAND_ACCENT, DEFAULT_BRAND_TITLE, deriveBrandColors } from '@klappe/shared';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from './api';

/**
 * White-Label pro Workspace (Phase 10).
 *
 * Das Erscheinungsbild wird ohne Anmeldung geladen – die Anmeldeseite und das
 * Gast-Gatter sollen Logo und Farbe zeigen, bevor überhaupt jemand
 * angemeldet ist. Bis die Antwort da ist, gilt der Standard; ein Umspringen
 * fällt kaum auf, weil nur der Akzent wechselt.
 */
const fallback: BrandingDto = {
  title: DEFAULT_BRAND_TITLE,
  ...deriveBrandColors(DEFAULT_BRAND_ACCENT),
  logoUrl: null,
  faviconMode: 'standard',
  faviconUrl: null,
  appIconUrl: null,
  companyName: null,
  companyShort: null,
  updatedAt: new Date(0).toISOString(),
};

/** Kennzeichnet den Link, den wir selbst gesetzt haben. */
const FAVICON_ATTRIBUT = 'data-klappe-favicon';

interface BrandingState {
  branding: BrandingDto;
  /** Nach dem Speichern in den Einstellungen aufrufen. */
  apply: (branding: BrandingDto) => void;
  reload: () => Promise<void>;
}

const BrandingContext = createContext<BrandingState | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingDto>(fallback);

  const reload = useCallback(async () => {
    try {
      setBranding(await api.getBranding());
    } catch {
      // Ohne Antwort bleibt es beim Standard – ein fehlendes Logo ist kein
      // Grund, die Seite nicht anzuzeigen.
      setBranding(fallback);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Die Farben liegen als CSS-Variablen vor; hier werden genau die drei
  // überschrieben, die den Akzent ausmachen.
  useEffect(() => {
    const style = document.documentElement.style;
    style.setProperty('--klappe-accent', branding.accent);
    style.setProperty('--klappe-accent-hover', branding.accentHover);
    style.setProperty('--klappe-accent-contrast', branding.accentContrast);
  }, [branding]);

  useEffect(() => {
    document.title = branding.title;
  }, [branding.title]);

  /**
   * Tab-Symbol und App-Symbol (Phasen 23 und 24).
   *
   * Next legt aus `app/icon.svg` selbst einen `<link rel="icon">` an. Statt
   * den zu entfernen, werden eigene **dahinter** gehängt: Browser nehmen bei
   * mehreren den zuletzt passenden, und bleiben unsere aus (Modus `standard`),
   * steht das mitgelieferte Zeichen unverändert da.
   *
   * Angehängt wird bevorzugt das gerasterte PNG. Ein SVG nahm der Tab nicht
   * überall an, und der iOS-Startbildschirm braucht für `apple-touch-icon`
   * ohnehin zwingend ein PNG – ein SVG dort lässt Safari das Symbol schlicht
   * weg und malt stattdessen einen Bildschirmausschnitt der Seite.
   */
  useEffect(() => {
    for (const alt of document.querySelectorAll(`link[${FAVICON_ATTRIBUT}]`)) alt.remove();

    const png = branding.appIconUrl;
    const quellen: { rel: string; href: string; type?: string }[] = [];

    if (png) {
      quellen.push({ rel: 'icon', href: png, type: 'image/png' });
      quellen.push({ rel: 'apple-touch-icon', href: png });
    } else if (branding.faviconUrl) {
      // Kein PNG erzeugt (etwa weil das Rastern scheiterte): Wenigstens im Tab
      // soll das eigene Symbol stehen.
      quellen.push({ rel: 'icon', href: branding.faviconUrl });
    }

    for (const quelle of quellen) {
      const link = document.createElement('link');
      link.rel = quelle.rel;
      link.href = quelle.href;
      if (quelle.type) link.type = quelle.type;
      link.setAttribute(FAVICON_ATTRIBUT, '');
      document.head.append(link);
    }
  }, [branding.appIconUrl, branding.faviconUrl]);

  const value = useMemo<BrandingState>(
    () => ({ branding, apply: setBranding, reload }),
    [branding, reload],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingState {
  const context = useContext(BrandingContext);
  if (!context) throw new Error('useBranding gehört unter den BrandingProvider.');
  return context;
}
