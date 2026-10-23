import { Check } from '@phosphor-icons/react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { GraphGroup } from '../../lib/api/graph-types';
import type { TagCount } from '../../lib/api/search-types';
import {
  GRAPH_TIME_WINDOWS,
  isGraphFilterStateActive,
  type GraphFilterState,
} from './graph-filter-state';
import './graph-time.css';

export interface GraphFilterBarProps {
  /** Colour groups on the map, in legend order. */
  groups: readonly GraphGroup[];
  state: GraphFilterState;
  onChange: (next: GraphFilterState) => void;
  onClear: () => void;
  /** `GET /tags` (null while loading or when it failed: the picker then offers no tags). */
  tags: readonly TagCount[] | null;
}

function PressedMark() {
  return <Check className="graph-chip__check" size={14} aria-hidden="true" focusable="false" />;
}

/**
 * Filters of the brain map (SPEC F24.2, design.md screen 6 "Bộ lọc"): folder chips (the legend's
 * colour groups, several at once), one tag, and a time window. Matching notes keep their colour,
 * the rest sink to 20 %; the side panel lists the matches. Chips are toggle buttons
 * (`aria-pressed`), the time windows a group of them where exactly one is pressed.
 */
export function GraphFilterBar({ groups, state, onChange, onClear, tags }: GraphFilterBarProps) {
  const { t } = useTranslation();
  const tagId = useId();
  const toggleGroup = (group: GraphGroup) =>
    onChange({
      ...state,
      groups: state.groups.includes(group)
        ? state.groups.filter((g) => g !== group)
        : [...state.groups, group],
    });
  // A remembered tag that no note has any more stays selectable, so the picker shows the truth.
  const tagOptions = [...(tags ?? [])];
  if (state.tag !== null && !tagOptions.some((tag) => tag.norm === state.tag)) {
    tagOptions.unshift({ tag: state.tag, norm: state.tag, count: 0 });
  }
  const shownGroups = [...new Set([...groups, ...state.groups])];

  return (
    <div
      className="graph-filters"
      role="group"
      aria-label={t('graph.filters.label')}
      data-graph-overlay
    >
      <div className="graph-filters__chips" role="group" aria-label={t('graph.filters.folders')}>
        {shownGroups.map((group) => (
          <button
            key={group}
            type="button"
            className="graph-chip"
            aria-pressed={state.groups.includes(group)}
            onClick={() => toggleGroup(group)}
          >
            {state.groups.includes(group) ? <PressedMark /> : null}
            <span className={`graph-legend__dot graph-legend__dot--${group}`} aria-hidden="true" />
            {t(`graph.legend.${group}`)}
          </button>
        ))}
      </div>
      <div className="graph-filters__tag">
        <label htmlFor={tagId}>{t('graph.filters.tag')}</label>
        <select
          id={tagId}
          className="graph-filters__select"
          value={state.tag ?? ''}
          onChange={(event) => onChange({ ...state, tag: event.target.value || null })}
        >
          <option value="">{t('graph.filters.anyTag')}</option>
          {tagOptions.map((tag) => (
            <option key={tag.norm} value={tag.norm}>
              {`#${tag.tag}`}
            </option>
          ))}
        </select>
      </div>
      <div className="graph-filters__chips" role="group" aria-label={t('graph.filters.time')}>
        {GRAPH_TIME_WINDOWS.map((time) => (
          <button
            key={time}
            type="button"
            className="graph-chip"
            aria-pressed={state.time === time}
            onClick={() => onChange({ ...state, time })}
          >
            {state.time === time ? <PressedMark /> : null}
            {t(`graph.filters.time_${time}`)}
          </button>
        ))}
      </div>
      {isGraphFilterStateActive(state) ? (
        <button
          type="button"
          className="button button--secondary graph-filters__clear"
          onClick={onClear}
        >
          {t('graph.filters.clear')}
        </button>
      ) : null}
    </div>
  );
}
