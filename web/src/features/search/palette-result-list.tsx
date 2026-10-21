import { useEffect, useId } from 'react';
import type { PaletteEntry } from './palette-entries';
import { PaletteEntryView } from './palette-entry-view';

export interface PaletteResultListProps {
  id: string;
  label: string;
  entries: PaletteEntry[];
  activeIndex: number;
  optionId: (index: number) => string;
  onActivate: (index: number) => void;
  onChoose: (index: number, newTab: boolean) => void;
  /** Heading of the "Theo nghĩa" group (hits by meaning, always the last rows). */
  semanticLabel?: string;
}

/**
 * The palette's listbox. Focus stays in the input (combobox with `aria-activedescendant`), so
 * rows only react to the pointer; the active row is scrolled into view as it moves. Hits by
 * meaning form a labelled group at the end (ARIA grouped listbox), reached with the same ↑/↓.
 */
export function PaletteResultList({
  id,
  label,
  entries,
  activeIndex,
  optionId,
  onActivate,
  onChoose,
  semanticLabel = '',
}: PaletteResultListProps) {
  const groupLabelId = useId();
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, optionId]);

  const option = (entry: PaletteEntry, index: number) => (
    <li
      key={entry.key}
      id={optionId(index)}
      role="option"
      aria-selected={index === activeIndex}
      className={index === activeIndex ? 'palette-option is-active' : 'palette-option'}
      onMouseMove={() => {
        if (index !== activeIndex) onActivate(index);
      }}
      // Keep focus (and the caret) in the input.
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => onChoose(index, event.ctrlKey || event.metaKey)}
      onAuxClick={(event) => {
        if (event.button === 1) onChoose(index, true);
      }}
    >
      <PaletteEntryView entry={entry} />
    </li>
  );

  const firstSemantic = entries.findIndex((entry) => entry.kind === 'semantic');
  const main = firstSemantic === -1 ? entries : entries.slice(0, firstSemantic);
  const semantic = firstSemantic === -1 ? [] : entries.slice(firstSemantic);

  return (
    <ul id={id} className="palette-list" role="listbox" aria-label={label}>
      {main.map(option)}
      {semantic.length > 0 ? (
        <li role="presentation" className="palette-group">
          <ul role="group" aria-labelledby={groupLabelId} className="palette-group__list">
            <li role="presentation" id={groupLabelId} className="palette-group__label">
              {semanticLabel}
            </li>
            {semantic.map((entry, k) => option(entry, firstSemantic + k))}
          </ul>
        </li>
      ) : null}
    </ul>
  );
}
