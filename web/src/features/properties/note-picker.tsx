import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LinkTargetNote } from '../../lib/api/link-targets-types';
import { foldText } from '../../lib/fold-text';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { parentFolder } from '../../lib/vault-paths';

const MAX_MATCHES = 8;

/** `"[[Title]]"`, or the path form when the title is not unique in the vault (SPEC §4.4). */
export function noteLinkValue(note: LinkTargetNote): string {
  return note.unique ? `[[${note.title}]]` : `[[${note.path.replace(/\.md$/i, '')}]]`;
}

interface NotePickerProps {
  label: string;
  onPick: (link: string) => void;
}

/** Picks a note for `course`: diacritic-insensitive filter, Enter takes the first match. */
export function NotePicker({ label, onPick }: NotePickerProps) {
  const { t } = useTranslation();
  const id = useId();
  const titles = useLinkTargetsStore((state) => state.titles);
  const status = useLinkTargetsStore((state) => state.status);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (status === 'idle') void useLinkTargetsStore.getState().fetchTargets();
  }, [status]);

  const matches = useMemo(() => {
    const folded = foldText(query.trim());
    return titles
      .filter((note) => note.class !== 'template' && foldText(note.title).includes(folded))
      .slice(0, MAX_MATCHES);
  }, [titles, query]);

  return (
    <div className="property-picker">
      <label className="property-form__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="text-input"
        type="text"
        value={query}
        aria-controls={`${id}-list`}
        placeholder={t('properties.pickNotePlaceholder')}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const first = matches[0];
          if (first) onPick(noteLinkValue(first));
        }}
      />
      {matches.length === 0 ? (
        <p className="text-small">{t('properties.noNoteMatches')}</p>
      ) : (
        <ul
          id={`${id}-list`}
          className="property-choices"
          aria-label={t('properties.matchingNotes')}
        >
          {matches.map((note) => (
            <li key={note.path}>
              <button
                type="button"
                className="property-choices__option"
                onClick={() => onPick(noteLinkValue(note))}
              >
                <span>{note.title}</span>
                <span className="text-small">{parentFolder(note.path)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
