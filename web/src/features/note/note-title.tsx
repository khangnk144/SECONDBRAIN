import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperationResult } from '../../lib/operation-result';

interface NoteTitleProps {
  id: string;
  /** The current title (file name without `.md`). */
  title: string;
  editable: boolean;
  /** Freshly created note (`&new=1`): focus and select the title once. */
  autoSelect: boolean;
  onAutoSelected: () => void;
  /** Renames with relink; the field goes back to the old title unless it worked. */
  onRename: (title: string) => Promise<OperationResult>;
  /** Enter: done with the title, continue in the body. */
  onEnter: () => void;
}

/** The note title (34 px), editable in place: Enter or leaving the field renames, Esc reverts. */
export function NoteTitle(props: NoteTitleProps) {
  const { id, title, editable, autoSelect, onAutoSelected, onRename, onEnter } = props;
  const { t } = useTranslation();
  const [value, setValue] = useState(title);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const autoSelected = useRef(onAutoSelected);
  autoSelected.current = onAutoSelected;

  useEffect(() => setValue(title), [title]);
  useEffect(() => {
    if (!autoSelect) return;
    input.current?.focus();
    input.current?.select();
    autoSelected.current();
  }, [autoSelect]);

  const commit = async () => {
    const next = value.trim();
    if (busy.current || next === title) {
      if (!busy.current) setValue(title);
      return;
    }
    busy.current = true;
    try {
      const result = await onRename(next);
      // On success the path (and so `title`) changes; otherwise show the real name again.
      if (!result.ok) setValue(title);
    } finally {
      busy.current = false;
    }
  };

  return (
    <h1 id={id} className="note-title">
      <input
        ref={input}
        className="note-title__input text-display"
        type="text"
        value={value}
        readOnly={!editable}
        spellCheck={false}
        aria-label={t('note.title.label')}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            // The blur that follows finds the rename already running and does nothing more.
            void commit();
            // Only while the title still has focus: never take a caret the user placed elsewhere.
            if (document.activeElement === input.current) onEnter();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setValue(title);
            requestAnimationFrame(() => input.current?.select());
          }
        }}
      />
    </h1>
  );
}
