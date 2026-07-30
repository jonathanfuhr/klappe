'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Das „…“-Menü für Aktionen, die keinen eigenen Knopf verdienen – Umbenennen,
 * Löschen und Ähnliches (Phase 15).
 *
 * Das Panel hängt **am `body`**, nicht am Auslöser. Absolut positioniert im
 * Auslöser-Container wurde es von jedem beschneidenden Vorfahren gekappt – auf
 * den Projekt- und Videokacheln etwa von `.tile { overflow: hidden }`, das
 * dort das Vorschaubild an den runden Ecken hält. Ein Menü kann sich nicht
 * darauf verlassen, wo es eingesetzt wird; also legt es sich darüber und merkt
 * sich die Stelle in Fensterkoordinaten.
 *
 * Beim Rollen und bei Größenänderungen schließt es. Mitzuwandern hieße, an
 * jedem Scroll-Container zu lauschen; das Menü ist ohnehin eine kurze
 * Entscheidung.
 */
export function Menu({ label = 'Aktionen', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [platz, setPlatz] = useState<{ top: number; right: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const schliessen = (event: MouseEvent) => {
      const ziel = event.target as Node;
      // Das Panel liegt außerhalb des Wrappers – beide müssen gefragt werden,
      // sonst schlösse der Klick auf einen Eintrag das Menü, bevor er wirkt.
      if (wrapperRef.current?.contains(ziel) || panelRef.current?.contains(ziel)) return;
      setOpen(false);
    };
    const taste = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const wegdamit = () => setOpen(false);

    document.addEventListener('mousedown', schliessen);
    document.addEventListener('keydown', taste);
    // `true`: auch das Rollen in einem inneren Container zählt.
    window.addEventListener('scroll', wegdamit, true);
    window.addEventListener('resize', wegdamit);
    return () => {
      document.removeEventListener('mousedown', schliessen);
      document.removeEventListener('keydown', taste);
      window.removeEventListener('scroll', wegdamit, true);
      window.removeEventListener('resize', wegdamit);
    };
  }, [open]);

  const umschalten = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rahmen = triggerRef.current?.getBoundingClientRect();
    if (rahmen) {
      setPlatz({ top: rahmen.bottom + 4, right: window.innerWidth - rahmen.right });
    }
    setOpen(true);
  };

  return (
    <div
      ref={wrapperRef}
      className="menu"
      // Ein Menü in einer verlinkten Kachel darf die Navigation nicht auslösen.
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="iconbutton menu__trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={umschalten}
      >
        ⋯
      </button>
      {open && platz
        ? createPortal(
            <div
              ref={panelRef}
              className="menu__panel"
              role="menu"
              style={{ top: platz.top, right: platz.right }}
              // Auch im Portal: Der Klick soll nichts darunter auslösen.
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
              }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function MenuItem({
  children,
  onSelect,
  danger = false,
}: {
  children: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? 'menu__item menu__item--danger' : 'menu__item'}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}
