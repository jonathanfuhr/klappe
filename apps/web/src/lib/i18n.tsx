'use client';

import type { Locale, Vars } from '@klappe/shared';
import { DEFAULT_LOCALE, createTranslator, resolveLocale } from '@klappe/shared';
import { Fragment, type ReactNode, createContext, useContext, useEffect, useMemo } from 'react';
import { type MessageKey, de } from '@/i18n/de';
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

/**
 * Die Übersetzungsfunktion, auf die Schlüssel des deutschen Wörterbuchs
 * eingeengt. Ein Tippfehler im Schlüssel ist damit ein Typfehler und kein
 * Text, der erst in der Oberfläche als Rohschlüssel auffällt.
 */
export type Translator = (key: MessageKey, vars?: Vars) => string;

// Weiterreichen, damit Beschriftungstabellen ihre Schlüssel typsicher führen
// können, ohne das Wörterbuch selbst zu importieren.
export type { MessageKey };

interface I18nState {
  locale: Locale;
  t: Translator;
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
export function useT(): Translator {
  return useI18n().t;
}

/** Die geltende Sprache, etwa für Datums- und Zahlenformate. */
export function useLocale(): Locale {
  return useI18n().locale;
}

/**
 * Ein übersetzter Satz, in dem einzelne Platzhalter keine Zeichen sind,
 * sondern Bauteile – ein Link, ein `<code>`, ein fett gesetztes Wort.
 *
 * Der Satz bleibt dabei ein Satz. Ihn in „Wie sich ein Gerät verbindet, steht
 * in der" + Link + „; wer selbst etwas bauen will …" zu zerlegen, wäre für
 * Deutsch gerade noch gegangen und für jede weitere Sprache falsch: Wo im Satz
 * der Link steht, entscheidet die Sprache, nicht der Code.
 *
 *     <Trans k="apiAccess.docsHint" parts={{ link: <a href="/handbuch">…</a> }} />
 *
 * Gewöhnliche Werte kommen wie sonst über `vars`; `parts` ist nur für das,
 * was kein Text ist.
 */
export function Trans({
  k,
  vars,
  parts,
}: {
  k: MessageKey;
  vars?: Vars;
  parts: Record<string, ReactNode>;
}) {
  const t = useT();
  // Erst übersetzen und die gewöhnlichen Werte einsetzen, dann an den übrigen
  // Platzhaltern auftrennen – so bleibt die Wortstellung die der Übersetzung.
  const satz = t(k, vars);
  const namen = Object.keys(parts);
  if (namen.length === 0) return <>{satz}</>;

  const trenner = new RegExp(`\\{(${namen.join('|')})\\}`, 'g');
  const stuecke = satz.split(trenner);

  // `split` mit einer Gruppe liefert abwechselnd Text und Platzhaltername.
  return (
    <>
      {stuecke.map((stueck, index) =>
        index % 2 === 1 ? (
          <Fragment key={`${k}-${index}`}>{parts[stueck]}</Fragment>
        ) : (
          <Fragment key={`${k}-${index}`}>{stueck}</Fragment>
        ),
      )}
    </>
  );
}
