import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { GraphFilterMask } from './graph-filter-state';
import type { GraphModel } from './graph-model';
import { graphFolderLabel, graphNodeListName } from './graph-node-names';
import { filteredGraphNodes, searchGraphNodes } from './graph-search';

export interface GraphNodeSearchProps {
  model: GraphModel | null;
  onSelect: (id: string) => void;
  /** Active filter (F24.2): only matches are found; with an empty box they are all listed. */
  filter?: GraphFilterMask | null;
  /** Notes edited in the last 24 h, marked "sửa trong 24 giờ" (F24.3). */
  recent?: ReadonlySet<string> | null;
}

/**
 * Search box of the side panel (combobox + listbox): ↑/↓ move through the matches, Enter
 * selects one (the canvas highlights it exactly as a click would), Escape clears the box.
 * While a filter is on, the list shows its matches even before anything is typed.
 */
export function GraphNodeSearch({ model, onSelect, filter, recent }: GraphNodeSearchProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const hintId = `${baseId}-hint`;
  const inputId = `${baseId}-input`;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const match = filter?.match ?? null;
  const hasQuery = query.trim() !== '';
  const { results, total } = useMemo(() => {
    if (query.trim() !== '' || !match) return searchGraphNodes(model, query, match);
    return filteredGraphNodes(model, match);
  }, [model, query, match]);
  const activeIndex = results.length === 0 ? -1 : Math.min(active, results.length - 1);
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const choose = (index: number) => {
    const node = results[index];
    if (node) onSelect(node.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (results.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.min(results.length - 1, Math.max(0, activeIndex + step)));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      choose(activeIndex);
    } else if (event.key === 'Escape' && query !== '') {
      event.preventDefault();
      setQuery('');
    }
  };

  let status = '';
  if (hasQuery) {
    const none = match ? 'graph.panel.noMatchesFiltered' : 'graph.panel.noMatches';
    status =
      total === 0 ? t(none, { query: query.trim() }) : t('graph.panel.matches', { count: total });
  } else if (match) {
    status =
      total === 0 ? t('graph.panel.filterNone') : t('graph.panel.filterMatches', { count: total });
  }

  return (
    <div className="graph-search">
      <label htmlFor={inputId} className="graph-panel__label">
        {t('graph.panel.search')}
      </label>
      <input
        id={inputId}
        className="text-input"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-describedby={hintId}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      <p id={hintId} className="graph-panel__hint">
        {t('graph.panel.searchHint')}
      </p>
      <p role="status" className="graph-panel__count">
        {status}
      </p>
      <ul
        id={listId}
        role="listbox"
        aria-label={t('graph.panel.resultsLabel')}
        className="graph-results"
        hidden={results.length === 0}
      >
        {results.map((node, index) => {
          const isRecent = recent?.has(node.id) === true;
          return (
            <li
              key={node.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              aria-label={graphNodeListName(t, node, isRecent)}
              className={
                index === activeIndex ? 'graph-results__item is-active' : 'graph-results__item'
              }
              onMouseMove={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <span className="graph-results__title">{node.title}</span>
              <span className="graph-results__folder">{graphFolderLabel(t, node)}</span>
              {isRecent ? <span className="graph-recent">{t('graph.panel.recent')}</span> : null}
            </li>
          );
        })}
      </ul>
      {total > results.length ? (
        <p className="graph-panel__hint">
          {t('graph.panel.moreMatches', { count: total - results.length })}
        </p>
      ) : null}
    </div>
  );
}
