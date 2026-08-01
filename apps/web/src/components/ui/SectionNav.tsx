'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
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
 * gibt. Jetzt fährt dieselbe senkrechte Liste hinter einem Hamburger-Symbol von
 * links herein – über den Inhalt, nicht in ihn hinein. Aufgeklappt *im*
 * Textfluss schob sie sonst alles nach unten weg, und nach der Wahl sprang die
 * Seite wieder zurück.
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
  const t = useT();
  const [offen, setOffen] = useState(false);
  const gewaehlt = items.find((eintrag) => eintrag.id === active);

  // Ein Wechsel des Bereichs schließt die Schublade wieder.
  useEffect(() => {
    setOffen(false);
  }, [active]);

  /**
   * Solange die Schublade offen ist: Escape schließt sie, und die Seite
   * darunter rollt nicht mit. Ohne die Sperre wischt man auf dem Handy am
   * Menü vorbei und scrollt den Text dahinter.
   */
  useEffect(() => {
    if (!offen) return;

    const taste = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOffen(false);
    };
    document.addEventListener('keydown', taste);

    const vorher = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', taste);
      document.body.style.overflow = vorher;
    };
  }, [offen]);

  return (
    <nav className="sectionnav" aria-label={title} data-open={offen}>
      <span className="sectionnav__title">{title}</span>

      <button
        type="button"
        className="sectionnav__toggle"
        aria-expanded={offen}
        onClick={() => setOffen(true)}
      >
        <Icon name="menu" />
        <span className="sectionnav__toggle-label">{gewaehlt?.label ?? title}</span>
      </button>

      {/*
       * Der Schleier liegt zwischen Seite und Schublade. Ein Klick darauf
       * schließt – der eingeführte Weg, ein Menü loszuwerden, ohne einen
       * Eintrag zu treffen. Für die Tastatur gibt es Escape, deshalb ist er
       * vor Vorlesewerkzeugen verborgen.
       */}
      <button
        type="button"
        className="sectionnav__backdrop"
        tabIndex={-1}
        aria-hidden
        onClick={() => setOffen(false)}
      />

      <div className="sectionnav__list">
        <div className="sectionnav__drawerhead">
          <span className="sectionnav__drawertitle">{title}</span>
          <button
            type="button"
            className="iconbutton"
            aria-label={t('toolbar.closeMenu')}
            onClick={() => setOffen(false)}
          >
            ×
          </button>
        </div>

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
