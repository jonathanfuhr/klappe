'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';

export interface SectionNavItem {
  id: string;
  label: string;
  /** Gesetzt: der Eintrag springt zu einem Anker, statt umzuschalten. */
  href?: string;
}

/**
 * Das senkrechte Menü links neben einem langen Inhalt – Einstellungen und
 * Handbuch teilen es sich (Phase 24).
 *
 * Auf schmalen Schirmen stand hier bisher eine waagerecht rollbare Reiterreihe.
 * Sie sah aus wie ein abgeschnittener Satz: Was rechts noch kam, war nicht zu
 * ahnen, und die Reihe verriet nicht einmal, wie viele Bereiche es überhaupt
 * gibt. Jetzt klappt dieselbe senkrechte Liste hinter einem Hamburger-Symbol
 * auf, das den gerade offenen Bereich beim Namen nennt.
 */
export function SectionNav({
  title,
  items,
  active,
  onSelect,
}: {
  title: string;
  items: readonly SectionNavItem[];
  /** Ohne Angabe wird kein Eintrag hervorgehoben – so beim Handbuch. */
  active?: string;
  onSelect?: (id: string) => void;
}) {
  const [offen, setOffen] = useState(false);
  const gewaehlt = items.find((eintrag) => eintrag.id === active);

  // Ein Wechsel des Bereichs schließt die Liste wieder: Auf dem Handy stünde
  // sonst das Menü über dem Inhalt, den man gerade aufgerufen hat.
  useEffect(() => {
    setOffen(false);
  }, [active]);

  return (
    <nav className="sectionnav" aria-label={title} data-open={offen}>
      <span className="sectionnav__title">{title}</span>

      <button
        type="button"
        className="sectionnav__toggle"
        aria-expanded={offen}
        onClick={() => setOffen((zustand) => !zustand)}
      >
        <Icon name="menu" />
        <span className="sectionnav__toggle-label">{gewaehlt?.label ?? title}</span>
      </button>

      <div className="sectionnav__list">
        {items.map((eintrag) =>
          eintrag.href ? (
            <a
              key={eintrag.id}
              className="sectionnav__item"
              href={eintrag.href}
              data-active={active === eintrag.id}
              onClick={() => setOffen(false)}
            >
              {eintrag.label}
            </a>
          ) : (
            <button
              key={eintrag.id}
              type="button"
              className="sectionnav__item"
              data-active={active === eintrag.id}
              onClick={() => {
                onSelect?.(eintrag.id);
                setOffen(false);
              }}
            >
              {eintrag.label}
            </button>
          ),
        )}
      </div>
    </nav>
  );
}
