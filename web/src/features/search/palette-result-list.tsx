import { useEffect } from 'react';
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
}

/**
 * The palette's listbox. Focus stays in the input (combobox with `aria-activedescendant`), so
 * rows only react to the pointer; the active row is scrolled into view as it moves.
 */
export function PaletteResultList({
  id,
  label,
  entries,
  activeIndex,
  optionId,
  onActivate,
  onChoose,
}: PaletteResultListProps) {
  useEffect(() => {
    if (activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, optionId]);

  return (
    <ul id={id} className="palette-list" role="listbox" aria-label={label}>
      {entries.map((entry, index) => (
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
      ))}
    </ul>
  );
}
