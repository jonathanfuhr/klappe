'use client';

import { useEffect, useRef, useState } from 'react';

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  /** Farbtupfer, z. B. die Schlagwortfarbe. */
  color?: string;
}

/**
 * Mehrfachauswahl-Filter für die Projektliste (Phase 16): ein Knopf, der den
 * Stand zusammenfasst, darunter ein Panel mit Häkchen. Eine Dimension pro
 * Instanz – Kunde, ein benutzerdefiniertes Feld oder die Schlagworte.
 */
export function FilterSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
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

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((entry) => entry !== value)
        : [...selected, value],
    );
  };

  return (
    <div ref={wrapperRef} className="menu">
      <button
        type="button"
        className="button"
        data-active={selected.length > 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        style={selected.length > 0 ? { borderColor: 'var(--klappe-accent)' } : undefined}
      >
        {label}
        {selected.length > 0 ? ` (${selected.length})` : ''}
      </button>
      {open ? (
        <div className="menu__panel" role="listbox" style={{ maxHeight: 280, overflowY: 'auto' }}>
          {options.length === 0 ? (
            <span className="faint" style={{ fontSize: 13, padding: '6px 10px' }}>
              Keine Werte vorhanden.
            </span>
          ) : (
            options.map((option) => (
              <label
                key={option.value}
                className="menu__item"
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={() => toggle(option.value)}
                />
                {option.color ? (
                  <span
                    aria-hidden
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 99,
                      background: option.color,
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                <span style={{ flex: 1 }}>{option.label}</span>
                {option.count !== undefined ? (
                  <span className="faint" style={{ fontSize: 12 }}>
                    {option.count}
                  </span>
                ) : null}
              </label>
            ))
          )}
          {selected.length > 0 ? (
            <button
              type="button"
              className="menu__item"
              style={{ borderTop: '1px solid var(--klappe-border)', marginTop: 4 }}
              onClick={() => onChange([])}
            >
              Auswahl aufheben
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
