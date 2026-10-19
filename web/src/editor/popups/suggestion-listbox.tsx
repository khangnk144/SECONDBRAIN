import type { Editor } from '@tiptap/core';
import type { ReactNode } from 'react';
import { useActiveDescendant, usePopupPlacement } from './popup-hooks';

export interface SuggestionListboxProps<T> {
  editor: Editor;
  /** Document position the popup is placed under (the trigger's first character). */
  anchorPos: number;
  id: string;
  label: string;
  items: readonly T[];
  activeIndex: number;
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  onChoose: (index: number) => void;
  onHover: (index: number) => void;
  /** Shown instead of the list when it is empty (loading, nothing found). */
  emptyText?: string;
}

/**
 * Popup list for the editor's suggestions: `role="listbox"` whose active option is announced
 * through `aria-activedescendant` on the editor (the caret never leaves the text). Mouse works
 * too; pressing on an option does not take the focus away from the editor.
 */
export function SuggestionListbox<T>(props: SuggestionListboxProps<T>) {
  const { editor, anchorPos, id, label, items, activeIndex } = props;
  const { ref, style } = usePopupPlacement(editor, anchorPos, `${items.length}`);
  const optionId = (index: number) => `${id}-option-${index}`;
  useActiveDescendant(
    editor,
    id,
    items.length > 0 && activeIndex >= 0 ? optionId(activeIndex) : null,
  );

  return (
    <div ref={ref} className="editor-popup" style={style} onMouseDown={(e) => e.preventDefault()}>
      {items.length === 0 && props.emptyText ? (
        <p className="editor-popup__empty" role="status">
          {props.emptyText}
        </p>
      ) : null}
      <ul id={id} role="listbox" aria-label={label} className="editor-popup__list">
        {items.map((item, index) => (
          <li
            key={props.itemKey(item)}
            id={optionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            className="editor-popup__option"
            onMouseMove={() => {
              if (index !== activeIndex) props.onHover(index);
            }}
            onClick={() => props.onChoose(index)}
          >
            {props.renderItem(item)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Up/Down move (wrapping), Enter or Tab choose; other keys stay with the editor. */
export function listKeyHandler(
  count: number,
  activeIndex: number,
  setActive: (index: number) => void,
  choose: (index: number) => void,
) {
  return (event: KeyboardEvent): boolean => {
    if (count === 0) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((activeIndex + step + count) % count);
      return true;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
      choose(activeIndex);
      return true;
    }
    return false;
  };
}
