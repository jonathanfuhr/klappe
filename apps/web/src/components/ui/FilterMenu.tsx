'use client';

import { Icon } from './Icon';
import { Menu } from './Menu';

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  /** Farbtupfer, z. B. die Schlagwortfarbe. */
  color?: string;
}

export interface FilterDimension {
  id: string;
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
}

/**
 * Alle Filter-Dimensionen in **einem** Panel hinter einem Trichter-Symbol
 * (Phase 24).
 *
 * Vorher stand jede Dimension als eigener beschrifteter Knopf in einer Leiste
 * quer über die Seite – bei Kunde, drei Freifeldern und Schlagworten waren das
 * fünf Knöpfe plus zwei Auswahlfelder, und auf dem Handy brach die Reihe in
 * vier Zeilen um, bevor überhaupt ein Projekt zu sehen war. Jetzt liegen die
 * Dimensionen untereinander in einem Panel; die Zahl am Symbol sagt, wie viele
 * Werte gerade gesetzt sind.
 *
 * Bewusst **keine** verschachtelten Aufklapp-Menüs: Ein Panel im Panel wird vom
 * Rollbereich des äußeren abgeschnitten, und zwei Ebenen zum Zuklappen sind auf
 * einem Handy ohnehin zu viel.
 */
export function FilterMenu({
  dimensions,
  onReset,
}: {
  dimensions: FilterDimension[];
  onReset: () => void;
}) {
  const gesetzt = dimensions.reduce((summe, dimension) => summe + dimension.selected.length, 0);

  const umschalten = (dimension: FilterDimension, value: string) => {
    dimension.onChange(
      dimension.selected.includes(value)
        ? dimension.selected.filter((eintrag) => eintrag !== value)
        : [...dimension.selected, value],
    );
  };

  return (
    <Menu
      label={gesetzt > 0 ? `Filter (${gesetzt} gesetzt)` : 'Filter'}
      align="left"
      closeOnSelect={false}
      triggerClassName="iconbutton listbar__button"
      trigger={
        <>
          <Icon name="filter" />
          {gesetzt > 0 ? <span className="listbar__count">{gesetzt}</span> : null}
        </>
      }
    >
      {dimensions.length === 0 ? (
        <span className="faint" style={{ fontSize: 13, padding: '6px 10px' }}>
          Keine Filter vorhanden.
        </span>
      ) : null}

      {dimensions.map((dimension) => (
        <section key={dimension.id} className="filtermenu__group">
          <h3 className="filtermenu__title">{dimension.label}</h3>
          {dimension.options.length === 0 ? (
            <span className="faint" style={{ fontSize: 12, padding: '2px 10px' }}>
              Keine Werte vorhanden.
            </span>
          ) : (
            dimension.options.map((option) => (
              <label key={option.value} className="menu__item filtermenu__option">
                <input
                  type="checkbox"
                  checked={dimension.selected.includes(option.value)}
                  onChange={() => umschalten(dimension, option.value)}
                />
                {option.color ? (
                  <span
                    aria-hidden
                    className="filtermenu__dot"
                    style={{ background: option.color }}
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
        </section>
      ))}

      {gesetzt > 0 ? (
        <button type="button" className="menu__item filtermenu__reset" onClick={onReset}>
          Filter zurücksetzen
        </button>
      ) : null}
    </Menu>
  );
}
