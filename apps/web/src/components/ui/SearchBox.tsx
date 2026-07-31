'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { Icon } from './Icon';

/**
 * Suche hinter einem Lupen-Symbol (Phase 24).
 *
 * Das feste Eingabefeld nahm in der Kopfzeile der Projektliste dauerhaft Platz
 * weg, obwohl bei einer Handvoll Projekte kaum jemand sucht. Der Knopf klappt
 * es bei Bedarf auf; steht etwas darin, bleibt es offen, damit niemand einen
 * gesetzten Suchbegriff übersieht.
 */
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const t = useT();
  const beschriftung = placeholder ?? t('common.searchPlaceholder');
  const [offen, setOffen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const sichtbar = offen || value.length > 0;

  useEffect(() => {
    if (offen) inputRef.current?.focus();
  }, [offen]);

  if (!sichtbar) {
    return (
      <button
        type="button"
        className="iconbutton listbar__button"
        aria-label={t('common.search')}
        title={t('common.search')}
        aria-expanded={false}
        onClick={() => setOffen(true)}
      >
        <Icon name="search" />
      </button>
    );
  }

  return (
    <div className="searchbox">
      <span className="searchbox__icon" aria-hidden>
        <Icon name="search" size={16} />
      </span>
      <input
        ref={inputRef}
        className="input searchbox__input"
        type="search"
        placeholder={beschriftung}
        aria-label={beschriftung}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          // Leer und verlassen heißt: wieder einklappen.
          if (!value) setOffen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onChange('');
            setOffen(false);
          }
        }}
      />
    </div>
  );
}
