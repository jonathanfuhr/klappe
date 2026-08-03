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
export type IconName =
  | 'plus'
  | 'share'
  | 'download'
  | 'users'
  | 'comment'
  | 'bell'
  | 'eye'
  | 'eye-off'
  | 'menu'
  | 'search'
  | 'filter'
  | 'sort'
  | 'group'
  | 'tag'
  | 'fullscreen'
  | 'volume'
  | 'volume-off'
  | 'play'
  | 'pause'
  | 'frame-back'
  | 'frame-forward'
  | 'shuttle-back'
  | 'shuttle-forward'
  | 'pen';

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
  bell: (
    <>
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6z" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M2 12s3.6-6 10-6c1.9 0 3.5.5 4.9 1.2" />
      <path d="M20.4 9.3C21.4 10.5 22 12 22 12s-3.6 6-10 6c-1.9 0-3.5-.5-4.9-1.2" />
      <circle cx="12" cy="12" r="2.6" />
      <line x1="3.5" y1="3.5" x2="20.5" y2="20.5" />
    </>
  ),
  menu: (
    <>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <line x1="15.5" y1="15.5" x2="20" y2="20" />
    </>
  ),
  /* Trichter – das eingeführte Zeichen fürs Filtern. */
  filter: (
    <>
      <path d="M4 5h16l-6.2 7.4V19l-3.6-2v-4.6z" />
    </>
  ),
  /* Drei Balken abnehmender Länge mit Pfeil: Sortierung. */
  sort: (
    <>
      <line x1="4" y1="7" x2="14" y2="7" />
      <line x1="4" y1="12" x2="11" y2="12" />
      <line x1="4" y1="17" x2="8" y2="17" />
      <path d="M17 6v12" />
      <path d="M14.5 15.5 17 18l2.5-2.5" />
    </>
  ),
  /* Gestapelte Kästen: Gruppierung. */
  group: (
    <>
      <rect x="3.5" y="4" width="17" height="5" rx="1.2" />
      <rect x="3.5" y="12.5" width="17" height="7.5" rx="1.2" />
      <line x1="7" y1="16.2" x2="17" y2="16.2" />
    </>
  ),
  tag: (
    <>
      <path d="M11.4 3.5H20v8.6l-8.7 8.7a1.4 1.4 0 0 1-2 0l-6.6-6.6a1.4 1.4 0 0 1 0-2z" />
      <circle cx="16.4" cy="7.1" r="1.4" />
    </>
  ),
  /*
   * Vollbild: zwei Pfeile, die diagonal in die Ecken zeigen. Das ⛶ von vorher
   * war ein Schriftzeichen – es stand in jeder Schrift anders da und sagte
   * nicht, in welche Richtung es geht.
   *
   * Zwei Diagonalen und nicht vier: Mit allen vier Ecken wären es acht Striche
   * auf 18 × 18 Pixel, und daraus wird ein Fleck. So bleiben die Pfeilspitzen
   * auch am Handy als solche zu erkennen.
   */
  fullscreen: (
    <>
      <path d="M14.5 3.5H21v6.5" />
      <path d="M9.5 20.5H3V14" />
      <path d="M21 3.5 13.5 11" />
      <path d="M3 20.5 10.5 13" />
    </>
  ),
  /* Lautsprecher als Strichzeichnung – die Emoji davor brachten ihre eigene
     Farbe mit und fielen zwischen den übrigen Zeichen heraus. */
  volume: (
    <>
      <path d="M11 4.5 6.5 9H3v6h3.5l4.5 4.5z" />
      <path d="M15 9.8a3.4 3.4 0 0 1 0 4.4" />
      <path d="M17.6 7a7 7 0 0 1 0 10" />
    </>
  ),
  'volume-off': (
    <>
      <path d="M11 4.5 6.5 9H3v6h3.5l4.5 4.5z" />
      <line x1="16" y1="9.5" x2="21" y2="14.5" />
      <line x1="21" y1="9.5" x2="16" y2="14.5" />
    </>
  ),

  /*
   * Die Transportzeichen (1.5). Vorher standen hier Schriftzeichen – ◀| ▶ |▶
   * ✎ –, und die kamen aus verschiedenen Zeichensätzen: Jedes hatte seine
   * eigene Größe und Strichstärke, der Stift war winzig gegen den Rest. Als
   * Pfade im selben 24er-Raster sind sie endlich gleich groß.
   *
   * Alle im Umriss wie die übrigen Symbole. Ein gefülltes Play-Dreieck stünde
   * als einziges massiv in der Reihe.
   */
  play: (
    <>
      <path d="M7.5 4.8v14.4L19 12z" />
    </>
  ),
  pause: (
    <>
      <rect x="7" y="4.8" width="3.6" height="14.4" rx="0.9" />
      <rect x="13.4" y="4.8" width="3.6" height="14.4" rx="0.9" />
    </>
  ),
  /* Ein Bild zurück: Dreieck gegen die Wand. */
  'frame-back': (
    <>
      <path d="M18.5 5.4v13.2L9 12z" />
      <line x1="6" y1="5.4" x2="6" y2="18.6" />
    </>
  ),
  'frame-forward': (
    <>
      <path d="M5.5 5.4v13.2L15 12z" />
      <line x1="18" y1="5.4" x2="18" y2="18.6" />
    </>
  ),
  /* Zwei Dreiecke: schnelles Spulen. */
  'shuttle-back': (
    <>
      <path d="M11.5 6v12L3.5 12z" />
      <path d="M20.5 6v12L12.5 12z" />
    </>
  ),
  'shuttle-forward': (
    <>
      <path d="M3.5 6v12l8-6z" />
      <path d="M12.5 6v12l8-6z" />
    </>
  ),
  /* Stift mit Unterlage – erkennbar auch dort, wo er klein steht. */
  pen: (
    <>
      <path d="M12.5 20.5H21" />
      <path d="M16.2 3.9a2.1 2.1 0 0 1 3 3L7.6 18.4l-4 1 1-4z" />
      <path d="M14.7 5.4 17.7 8.4" />
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
