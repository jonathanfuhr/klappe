'use client';

import type { ReactElement } from 'react';

/**
 * Die paar Symbole, die die Werkzeugleisten brauchen (Phase 16) – als Inline-
 * SVG statt als Bibliothek: Es sind fünf Stück, alle im selben 24er-Raster mit
 * `currentColor`, und eine Abhängigkeit für 60 Zeilen Pfaddaten wäre
 * unverhältnismäßig.
 *
 * Ein Icon allein sagt nie, was es tut. Jede Verwendung gehört deshalb in
 * einen Knopf mit `aria-label` und `title` – siehe `IconButton`.
 */
export type IconName = 'plus' | 'share' | 'download' | 'users' | 'comment';

const PFADE: Record<IconName, ReactElement> = {
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 5.5a3.2 3.2 0 0 1 0 5.6" />
      <path d="M17.5 14.4c2 .7 3.2 2.3 3.2 4.6" />
    </>
  ),
  comment: (
    <>
      <path d="M20 4H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h4v4l4.5-4H20a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1z" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PFADE[name]}
    </svg>
  );
}

/**
 * Knopf mit Symbol. `label` ist Pflicht und landet als `aria-label` **und**
 * `title` – ohne beides wäre ein Symbol für Tastatur und Maus gleichermaßen
 * ein Rätsel.
 */
export function IconButton({
  icon,
  label,
  onClick,
  href,
  download,
  className = 'iconbutton',
}: {
  icon: IconName;
  label: string;
  onClick?: () => void;
  href?: string;
  download?: boolean;
  className?: string;
}) {
  if (href) {
    return (
      <a className={className} href={href} download={download} aria-label={label} title={label}>
        <Icon name={icon} />
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} />
    </button>
  );
}
