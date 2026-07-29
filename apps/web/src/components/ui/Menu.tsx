'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * Das „…“-Menü für Aktionen, die keinen eigenen Knopf verdienen – Umbenennen,
 * Löschen und Ähnliches (Phase 15).
 *
 * Bewusst ohne Portal: Das Panel liegt absolut im Auslöser-Container. Damit
 * funktioniert es auch in einer Kachel, die selbst ein Link ist – der Auslöser
 * fängt den Klick ab, bevor die Navigation greift.
 */
export function Menu({ label = 'Aktionen', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const schliessen = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const taste = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', schliessen);
    document.addEventListener('keydown', taste);
    return () => {
      document.removeEventListener('mousedown', schliessen);
      document.removeEventListener('keydown', taste);
    };
  }, [open]);

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
        type="button"
        className="iconbutton menu__trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        ⋯
      </button>
      {open ? (
        <div className="menu__panel" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
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
