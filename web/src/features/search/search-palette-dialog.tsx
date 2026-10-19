import { MagnifyingGlass } from '@phosphor-icons/react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchUi } from '../../lib/search-ui-store';
import { ModalFrame } from '../dialogs/modal-frame';
import { buildPaletteView, runPaletteEntry } from './palette-entries';
import { PaletteKeyHints } from './palette-key-hints';
import { PaletteResultList } from './palette-result-list';
import { usePaletteResults } from './use-palette-results';
import './search-palette.css';

/**
 * Search palette (design.md screen 5, SPEC F8): a combobox input over a listbox of results.
 * ↑/↓ move, Enter opens, Ctrl+Enter opens in a new tab, Esc closes and focus goes back to where
 * it was (ModalFrame). Global shortcuts are suspended while it is open.
 */
export function SearchPaletteDialog() {
  const { t } = useTranslation();
  const query = useSearchUi((state) => state.query);
  const results = usePaletteResults(query);
  const view = buildPaletteView(query, results);
  const { entries } = view;
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listId = useId();
  const hintsId = useId();
  const optionId = useCallback((index: number) => `${listId}-option-${index}`, [listId]);
  const [active, setActive] = useState(0);
  const activeIndex = entries.length === 0 ? -1 : Math.min(active, entries.length - 1);

  // New answers start at the top; a pre-filled query (`tag:…`) is selected so typing replaces it.
  useEffect(() => setActive(0), [results]);
  useEffect(() => inputRef.current?.select(), []);

  const close = () => useSearchUi.getState().close();
  const choose = (index: number, newTab: boolean) => {
    const entry = entries[index];
    if (!entry) return;
    close();
    runPaletteEntry(entry, newTab);
  };

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (entries.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.min(Math.max(activeIndex + step, 0), entries.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(activeIndex, event.ctrlKey || event.metaKey);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      // App shortcuts are suspended while the palette is open; keep Ctrl+K from reaching the
      // browser (address bar search) and let it select the query instead.
      event.preventDefault();
      event.currentTarget.select();
    }
  }

  const status = results.error
    ? t('search.error')
    : view.noMatch
      ? t('search.noResults', { query: query.trim() })
      : view.recent && entries.length === 0
        ? t('search.noRecent')
        : results.answered === null
          ? t('search.searching')
          : null;

  return (
    <ModalFrame
      labelledBy={titleId}
      onCancel={close}
      initialFocus={inputRef}
      className="search-palette"
    >
      <h2 id={titleId} className="visually-hidden">
        {t('search.dialogLabel')}
      </h2>
      <div className="search-palette__field">
        <MagnifyingGlass size={18} aria-hidden="true" focusable="false" />
        <input
          ref={inputRef}
          className="search-palette__input"
          type="text"
          role="combobox"
          aria-label={t('search.inputLabel')}
          aria-expanded={entries.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          aria-describedby={hintsId}
          placeholder={t('search.placeholder')}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => useSearchUi.getState().setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <p className={status ? 'search-palette__status' : 'visually-hidden'} role="status">
        {status ?? t('search.resultCount', { count: entries.length })}
      </p>
      <PaletteResultList
        id={listId}
        label={t(view.recent ? 'search.recentLabel' : 'search.resultsLabel')}
        entries={entries}
        activeIndex={activeIndex}
        optionId={optionId}
        onActivate={setActive}
        onChoose={choose}
      />
      <PaletteKeyHints id={hintsId} />
    </ModalFrame>
  );
}
