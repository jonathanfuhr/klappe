/**
 * Mehrsprachigkeit (Phase 26).
 *
 * Bis dahin standen alle Texte fest im Code. Der Kern hier ist bewusst klein
 * und ohne Abhängigkeit: ein Wörterbuch je Sprache, ein `t()` mit Platzhaltern
 * und Pluralformen. Eine Bibliothek wie `next-intl` bringt Routing mit Sprache
 * in der Adresse mit – das hätte jede bestehende Verknüpfung und die
 * Sitzungs-Weiche in `middleware.ts` angefasst, für einen Gegenwert, den drei
 * Dutzend Zeilen hier auch liefern.
 *
 * **Deutsch ist die Quellsprache.** Das englische Wörterbuch wird gegen das
 * deutsche typgeprüft (siehe `Dictionary`), ein vergessener Schlüssel bricht
 * also den Typecheck und fällt nicht erst im Betrieb als leerer Knopf auf.
 */

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Quellsprache und Rückfall, wenn nichts anderes feststeht. */
export const DEFAULT_LOCALE: Locale = 'de';

/** Für die Sprachwahl in der Oberfläche – in der jeweils eigenen Sprache. */
export const LOCALE_NAMES: Record<Locale, string> = {
  de: 'Deutsch',
  en: 'English',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Ein Eintrag ist entweder ein fertiger Text oder – wo gezählt wird – ein Paar
 * aus Einzahl und Mehrzahl. Deutsch und Englisch kommen beide mit diesen zwei
 * Formen aus; Sprachen mit mehr Formen (Polnisch, Russisch) bräuchten hier
 * eine Erweiterung, und genau dann lohnt sich auch die Diskussion über eine
 * Bibliothek.
 */
export type Message = string | { one: string; other: string };

/** Das Wörterbuch einer Sprache: flache Schlüssel wie `projekte.neu`. */
export type Dictionary = Record<string, Message>;

/**
 * Werte für Platzhalter. `{name}` im Text wird ersetzt; was fehlt, bleibt
 * sichtbar stehen – ein `{name}` im Bild fällt beim Prüfen auf, ein
 * stillschweigend leerer Satz nicht.
 */
export type Vars = Record<string, string | number>;

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (treffer, schluessel: string) => {
    const wert = vars[schluessel];
    return wert === undefined ? treffer : String(wert);
  });
}

/**
 * Baut die Übersetzungsfunktion für eine Sprache.
 *
 * Fehlt ein Schlüssel in der gewählten Sprache, greift das Wörterbuch der
 * Quellsprache; fehlt er auch dort, kommt der Schlüssel selbst zurück. Beides
 * ist hässlich und soll es sein – ein leerer Knopf wäre schlimmer, weil ihn
 * niemand meldet.
 */
export function createTranslator(dictionary: Dictionary, fallback: Dictionary) {
  return function t(key: string, vars?: Vars): string {
    const eintrag = dictionary[key] ?? fallback[key];
    if (eintrag === undefined) return key;

    if (typeof eintrag === 'string') return fill(eintrag, vars);

    // Ein Zählwert entscheidet über Einzahl oder Mehrzahl. Ohne `count` gilt
    // die Mehrzahl: „3 Projekte" ist der häufigere Fall in einer Liste.
    const anzahl = typeof vars?.count === 'number' ? vars.count : Number(vars?.count);
    const form = anzahl === 1 ? eintrag.one : eintrag.other;
    return fill(form, vars);
  };
}

export type Translator = ReturnType<typeof createTranslator>;

/**
 * Sprache aus einem `Accept-Language`-Kopf bestimmen – für alles, was ohne
 * Anmeldung erscheint: Anmeldeseite, Gast-Gatter, eingebetteter Player.
 *
 * Bewusst schlicht: Die Kopfzeile wird nach Gewicht sortiert und die erste
 * Sprache genommen, die wir kennen. Regionen (`de-AT`) zählen als ihre
 * Basissprache.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | null {
  if (!acceptLanguage) return null;

  const eintraege = acceptLanguage
    .split(',')
    .map((teil) => {
      const [sprache, ...rest] = teil.trim().split(';');
      const q = rest.find((eintrag) => eintrag.trim().startsWith('q='));
      const gewicht = q ? Number.parseFloat(q.trim().slice(2)) : 1;
      return { sprache: sprache.trim().toLowerCase(), gewicht: Number.isFinite(gewicht) ? gewicht : 0 };
    })
    .filter((eintrag) => eintrag.sprache.length > 0)
    .sort((a, b) => b.gewicht - a.gewicht);

  for (const eintrag of eintraege) {
    const basis = eintrag.sprache.split('-')[0];
    if (isLocale(basis)) return basis;
  }
  return null;
}

/**
 * Welche Sprache gilt für jemanden? Die eigene Wahl schlägt die Vorgabe des
 * Workspace, diese schlägt den Browser, und ganz zuletzt steht Deutsch.
 */
export function resolveLocale(
  eigene: string | null | undefined,
  workspace: string | null | undefined,
  browser?: string | null,
): Locale {
  if (isLocale(eigene)) return eigene;
  if (isLocale(workspace)) return workspace;
  return negotiateLocale(browser) ?? DEFAULT_LOCALE;
}
