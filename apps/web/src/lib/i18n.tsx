'use client';

import type { Locale } from '@klappe/shared';
import { DEFAULT_LOCALE, createTranslator, resolveLocale } from '@klappe/shared';
import { type ReactNode, createContext, useContext, useEffect, useMemo } from 'react';
import { de } from '@/i18n/de';
import { en } from '@/i18n/en';
import { useBranding } from './branding';
import { useSession } from './session';

/**
 * Sprache der Oberfläche (Phase 26).
 *
 * Woher sie kommt, in dieser Reihenfolge: die eigene Wahl unter „Profil und
 * Sicherheit", sonst die Vorgabe des Workspace, sonst der Browser, sonst
 * Deutsch. Die Vorgabe des Workspace steckt im Erscheinungsbild und wird auch
 * **ohne Anmeldung** geladen – die Anmeldeseite und das Gast-Gatter stehen
 * dadurch von Anfang an in der richtigen Sprache, statt erst auf Deutsch
 * aufzublitzen.
 */
const WOERTERBUECHER = { de, en };

interface I18nState {
  locale: Locale;
  t: ReturnType<typeof createTranslator>;
}

const I18nContext = createContext<I18nState | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const { branding } = useBranding();

  const locale = resolveLocale(
    user?.locale,
    branding.defaultLocale,
    // Auf dem Server gibt es kein `navigator`; dort zählt die Vorgabe.
    typeof navigator === 'undefined' ? null : navigator.language,
  );

  /*
   * `lang` am Wurzelelement nachziehen: Danach richten sich Silbentrennung,
   * Anführungszeichen und vor allem Vorlesewerkzeuge. Im Server-Markup steht
   * die Vorgabe aus `layout.tsx`; hier wird sie korrigiert, sobald die
   * tatsächliche Sprache feststeht.
   */
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nState>(
    () => ({
      locale,
      // Deutsch ist die Quellsprache und damit der Rückfall für alles, was in
      // einer Übersetzung fehlt.
      t: createTranslator(WOERTERBUECHER[locale] ?? de, de),
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nState {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useT gehört unter den I18nProvider.');
  return context;
}

/** Die Übersetzungsfunktion – der Normalfall in Komponenten. */
export function useT(): I18nState['t'] {
  return useI18n().t;
}

/** Die geltende Sprache, etwa für Datums- und Zahlenformate. */
export function useLocale(): Locale {
  return useI18n().locale;
}

export { DEFAULT_LOCALE };
