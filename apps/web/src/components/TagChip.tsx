'use client';

import type { TagRefDto } from '@klappe/shared';

interface TagChipProps {
  tag: TagRefDto;
  /** Als Filter ausgewählt. */
  active?: boolean;
  /** Zahl dahinter, etwa wie viele Projekte das Schlagwort tragen. */
  count?: number;
  small?: boolean;
  onClick?: () => void;
}

/**
 * Schlagwort als Plakette (Phase 12).
 *
 * Die Farbe kommt aus dem Tag selbst und wird als Rand und blasser Grund
 * eingesetzt statt als Füllung – so bleiben mehrere Plaketten nebeneinander
 * lesbar, ohne dass die Liste zum Farbkasten wird.
 */
export function TagChip({ tag, active = false, count, small = false, onClick }: TagChipProps) {
  const style = {
    '--tag-color': tag.color,
  } as React.CSSProperties;

  if (!onClick) {
    return (
      <span className="tag" data-small={small} style={style}>
        {tag.name}
        {count === undefined ? null : <span className="tag__count">{count}</span>}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="tag tag--button"
      data-active={active}
      data-small={small}
      style={style}
      onClick={onClick}
      aria-pressed={active}
    >
      {tag.name}
      {count === undefined ? null : <span className="tag__count">{count}</span>}
    </button>
  );
}
