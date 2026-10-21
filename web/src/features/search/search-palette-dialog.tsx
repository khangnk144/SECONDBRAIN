import { MagnifyingGlass } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchUi } from '../../lib/search-ui-store';
import { ModalFrame } from '../dialogs/modal-frame';
import { runPaletteEntry } from './palette-entries';
import { PaletteKeyHints } from './palette-key-hints';
import { completeFilter } from './palette-query';
import { PaletteResultList } from './palette-result-list';
import { markPaletteKeystroke, measurePaletteResults } from './palette-timing';
import { usePaletteView, type PaletteModel } from './use-palette-view';
import './search-palette.css';

/**
 * Search and command palette (design.md screen 5, SPEC F8): a combobox input over a listbox.
 * `>` lists commands; a filter being typed (`tag:`, `folder:`…) offers its values first. ↑/↓
 * move, Enter opens or runs (on a filter value: completes it), Ctrl+Enter opens in a new tab, Esc
 * closes and focus goes back to where it was (ModalFrame). Global shortcuts are suspended while
 * it is open.
 */
export function SearchPaletteDialog() {
  const { t } = useTranslation();
  const query = useSearchUi((state) => state.query);
  const model = usePaletteView(query);
  const { view, results } = model;
  const { entries } = view;
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listId = useId();
  const hintsId = useId();
  const filterHintId = useId();
  const optionId = useCallback((index: number) => `${listId}-option-${index}`, [listId]);
  const [active, setActive] = useState(0);
  const activeIndex = entries.length === 0 ? -1 : Math.min(active, entries.length - 1);

  // New answers (or a switch between notes and commands) start at the top; a pre-filled query
  // (`tag:…`) is selected so typing replaces it.
  const firstKey = entries[0]?.key;
  useEffect(() => setActive(0), [results, view.mode, firstKey]);
  useEffect(() => inputRef.current?.select(), []);
  useEffect(() => measurePaletteResults(results.answered), [results]);

  const close = () => useSearchUi.getState().close();
  const choose = (index: number, newTab: boolean) => {
    const entry = entries[index];
    if (!entry) return;
    if (entry.kind === 'filter') {
      const { token } = model;
      if (token) setQuery(completeFilter(query, token, entry.suggestion.value));
      inputRef.current?.focus();
      return;
    }
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

  const status = paletteStatus(model, query, t);
  const listLabel =
    view.mode === 'commands'
      ? 'search.commandsLabel'
      : view.recent
        ? 'search.recentLabel'
        : 'search.resultsLabel';

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
          aria-describedby={`${filterHintId} ${hintsId}`}
          placeholder={t('search.placeholder')}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <p id={filterHintId} className="search-palette__hint">
        {t(view.mode === 'commands' ? 'search.commandHint' : 'search.filterHint')}
      </p>
      <p className={status ? 'search-palette__status' : 'visually-hidden'} role="status">
        {status ??
          t(view.mode === 'commands' ? 'search.commandCount' : 'search.resultCount', {
            count: entries.length,
          })}
      </p>
      <PaletteResultList
        id={listId}
        label={t(listLabel)}
        entries={entries}
        activeIndex={activeIndex}
        optionId={optionId}
        onActivate={setActive}
        onChoose={choose}
      />
      <PaletteKeyHints id={hintsId} mode={view.mode} />
    </ModalFrame>
  );
}

function setQuery(query: string): void {
  markPaletteKeystroke(query);
  useSearchUi.getState().setQuery(query);
}

/** The visible status line, or null when the results speak for themselves. */
function paletteStatus(
  { view, results, commandQuery }: PaletteModel,
  query: string,
  t: TFunction,
): string | null {
  if (view.mode === 'commands') {
    return view.noMatch ? t('search.noCommands', { query: commandQuery ?? '' }) : null;
  }
  if (results.error) return t('search.error');
  if (view.noMatch) return t('search.noResults', { query: query.trim() });
  if (view.recent && view.entries.length === 0) return t('search.noRecent');
  return results.answered === null ? t('search.searching') : null;
}
