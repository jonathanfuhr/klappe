'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Luft zum Fensterrand, damit nie etwas bündig an der Kante klebt. */
const RAND = 8;

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
 *
 * `trigger` ersetzt bei Bedarf die „…“-Schaltfläche – das Benutzer-Menü in der
 * Kopfzeile hängt so am Namenskürzel (Phase 24).
 */
export function Menu({
  label = 'Aktionen',
  trigger,
  triggerClassName = 'iconbutton menu__trigger',
  align = 'right',
  closeOnSelect = true,
  children,
}: {
  label?: string;
  trigger?: ReactNode;
  triggerClassName?: string;
  /** An welcher Kante des Auslösers das Panel hängt. */
  align?: 'left' | 'right';
  /**
   * `false` für Panels, in denen mehrfach geklickt wird – das Filter-Panel der
   * Projektliste etwa hakt mehrere Werte nacheinander an und dürfte nach dem
   * ersten nicht zufallen.
   */
  closeOnSelect?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [platz, setPlatz] = useState<{ top: number; left: number } | null>(null);
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
    // Beim Rollen der Seite schließen – aber nicht, wenn im Panel selbst
    // gerollt wird. Eine lange Filterliste ließ sich sonst gar nicht bedienen:
    // Die erste Bewegung ließ sie verschwinden (Phase 24).
    const wegdamit = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

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

  /**
   * Nach dem ersten Zeichnen nachmessen und ins Fenster rücken.
   *
   * Vorher stand nur `right` fest; ein breites Menü an einem Auslöser weit
   * links lief damit über die **linke** Kante hinaus, und ein langes am unteren
   * Rand hinaus nach unten. Beides war auf dem Handy regelmäßig zu sehen. Jetzt
   * steht `left` fest, geklemmt auf das, was das Fenster hergibt; passt es nach
   * unten nicht, klappt das Panel über den Auslöser (Phase 24).
   */
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const rahmen = triggerRef.current?.getBoundingClientRect();
    if (!panel || !rahmen) return;

    const { width, height } = panel.getBoundingClientRect();
    const maxLinks = Math.max(RAND, window.innerWidth - width - RAND);
    const wunsch = align === 'right' ? rahmen.right - width : rahmen.left;
    const left = Math.min(Math.max(RAND, wunsch), maxLinks);

    let top = rahmen.bottom + 4;
    if (top + height > window.innerHeight - RAND) {
      // Über den Auslöser klappen – und wenn auch das nicht reicht, oben
      // andocken; die Höhe deckelt `.menu__panel` selbst.
      const darueber = rahmen.top - height - 4;
      top = darueber >= RAND ? darueber : RAND;
    }

    setPlatz((bisher) =>
      bisher && bisher.top === top && bisher.left === left ? bisher : { top, left },
    );
  }, [open, align]);

  const umschalten = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const rahmen = triggerRef.current?.getBoundingClientRect();
    // Erste Schätzung; der Layout-Effekt oben rückt sie nach dem Messen zurecht.
    if (rahmen) setPlatz({ top: rahmen.bottom + 4, left: rahmen.left });
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
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={umschalten}
      >
        {trigger ?? '⋯'}
      </button>
      {open && platz
        ? createPortal(
            <div
              ref={panelRef}
              className="menu__panel"
              role="menu"
              style={{ top: platz.top, left: platz.left }}
              // Auch im Portal: Der Klick soll nichts darunter auslösen.
              onClick={(event) => {
                event.stopPropagation();
                if (closeOnSelect) setOpen(false);
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

/**
 * Menü-Eintrag, der auf eine Seite führt (Phase 24). Bewusst ein `Link` und
 * kein Knopf mit `router.push`: So funktionieren Mittelklick und „in neuem Tab
 * öffnen“ wie überall sonst.
 */
export function MenuLink({
  children,
  href,
  active = false,
}: {
  children: ReactNode;
  href: string;
  active?: boolean;
}) {
  return (
    <Link role="menuitem" className="menu__item" href={href} data-active={active}>
      {children}
    </Link>
  );
}

/** Trennlinie zwischen zwei Gruppen von Einträgen. */
export function MenuSeparator() {
  return <hr className="menu__separator" />;
}
