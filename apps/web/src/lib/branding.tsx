'use client';

import type { BrandProfileRefDto, BrandingDto } from '@klappe/shared';
import {
  DEFAULT_BRAND_ACCENT,
  DEFAULT_BRAND_TITLE,
  DEFAULT_LOCALE,
  deriveBrandColors,
  effectiveBranding,
} from '@klappe/shared';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  defaultLocale: DEFAULT_LOCALE,
  ...deriveBrandColors(DEFAULT_BRAND_ACCENT),
  logoUrl: null,
  faviconUrl: null,
  appIconUrl: null,
  companyName: null,
  companyShort: null,
  updatedAt: new Date(0).toISOString(),
};

/** Kennzeichnet den Link, den wir selbst gesetzt haben. */
const FAVICON_ATTRIBUT = 'data-klappe-favicon';

interface BrandingState {
  /**
   * Das Erscheinungsbild, das **hier und jetzt** gilt: der Auftritt des
   * gezeigten Projekts, sonst das des Workspace (1.6). Wer nur anzeigt,
   * nimmt dieses – der Rest ist Innerei.
   */
  branding: BrandingDto;
  /** Das des Hauses, ohne Auftritt – für die Einstellungen. */
  workspace: BrandingDto;
  /** Nach dem Speichern in den Einstellungen aufrufen. */
  apply: (branding: BrandingDto) => void;
  /** Auftritt überlagern; `null` nimmt die Überlagerung wieder weg. */
  zeigeAuftritt: (profile: BrandProfileRefDto | null) => void;
  reload: () => Promise<void>;
}

const BrandingContext = createContext<BrandingState | null>(null);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<BrandingDto>(fallback);
  /**
   * Der Auftritt des gerade gezeigten Projekts (1.6). Steht hier oben und
   * nicht in der Seite, weil auch der Kopf der Anwendung, das Browser-Tab
   * und die Farbvariablen davon abhängen – die liegen alle über der Seite.
   */
  const [auftritt, setAuftritt] = useState<BrandProfileRefDto | null>(null);

  const reload = useCallback(async () => {
    try {
      setWorkspace(await api.getBranding());
    } catch {
      // Ohne Antwort bleibt es beim Standard – ein fehlendes Logo ist kein
      // Grund, die Seite nicht anzuzeigen.
      setWorkspace(fallback);
    }
  }, []);

  const branding = useMemo(() => effectiveBranding(workspace, auftritt), [workspace, auftritt]);

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
   * Next legt aus `app/icon.svg` selbst einen `<link rel="icon">` an. Statt den
   * zu entfernen, werden eigene **dahinter** gehängt: Browser nehmen bei
   * mehreren den zuletzt passenden, und ist keines hinterlegt, steht das
   * mitgelieferte Zeichen unverändert da.
   *
   * Die beiden sind unabhängig voneinander. Das Tab bekommt die `.ico`, der
   * Startbildschirm das PNG – ein SVG lässt Safari dort schlicht weg und malt
   * stattdessen einen Bildschirmausschnitt der Seite.
   */
  useEffect(() => {
    for (const alt of document.querySelectorAll(`link[${FAVICON_ATTRIBUT}]`)) alt.remove();

    const quellen: { rel: string; href: string; type?: string }[] = [];
    if (branding.faviconUrl) {
      quellen.push({ rel: 'icon', href: branding.faviconUrl, type: 'image/x-icon' });
    }
    if (branding.appIconUrl) {
      quellen.push({ rel: 'apple-touch-icon', href: branding.appIconUrl });
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
    () => ({ branding, workspace, apply: setWorkspace, zeigeAuftritt: setAuftritt, reload }),
    [branding, workspace, reload],
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingState {
  const context = useContext(BrandingContext);
  if (!context) throw new Error('useBranding gehört unter den BrandingProvider.');
  return context;
}

/**
 * Den Auftritt eines Projekts anlegen, solange die Seite steht (1.6).
 *
 * Aufzurufen von jeder Seite, die zu einem Projekt gehört – Projektseite,
 * Videoseite, Gast-Gatter. Beim Verlassen wird die Überlagerung wieder
 * abgenommen, sonst bliebe das Agenturlogo in der Projektliste stehen.
 *
 * Der Schlüssel enthält absichtlich mehr als die Kennung: Wird das Logo
 * gewechselt oder die Farbe geändert, während die Seite offen ist, soll das
 * ankommen. Die Kennung allein bliebe dieselbe, und die Seite zeigte bis zum
 * Neuladen den alten Stand.
 */
export function useProjektAuftritt(profile: BrandProfileRefDto | null | undefined): void {
  const { zeigeAuftritt } = useBranding();
  const neueste = useRef(profile ?? null);
  neueste.current = profile ?? null;

  const schluessel = profile
    ? `${profile.id}|${profile.name}|${profile.accent}|${profile.logoUrl ?? ''}`
    : '';

  useEffect(() => {
    zeigeAuftritt(neueste.current);
    return () => zeigeAuftritt(null);
  }, [schluessel, zeigeAuftritt]);
}
