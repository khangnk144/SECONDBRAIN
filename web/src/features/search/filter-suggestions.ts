/**
 * Value suggestions for the filter being typed (SPEC F8 filters): tags from the server, folders
 * from the tree, fixed lists for `type:`, `due:` and `class:`. Values that start with what is
 * typed come first, then values that contain it; a fixed value also matches its explanation
 * (`type:du` finds `project`, "Dự án"). Nothing is suggested once a value is typed in full.
 */
import type { TFunction } from 'i18next';
import type { TagCount } from '../../lib/api/search-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { foldText } from '../../lib/fold-text';
import { TYPE_VALUES } from '../properties/frontmatter-values';
import type { FilterKey, FilterToken } from './palette-query';

export const DUE_FILTER_VALUES = ['7d', '30d', 'overdue'] as const;
export const CLASS_FILTER_VALUES = ['archive'] as const;
export const MAX_FILTER_SUGGESTIONS = 8;

export interface FilterSuggestion {
  key: FilterKey;
  value: string;
  /** Translated explanation (tag count, type name, what `due:7d` means). */
  detail: string | null;
}

export interface FilterValueSources {
  tags: readonly TagCount[];
  folders: readonly VaultPath[];
}

interface Candidate {
  value: string;
  detail: string | null;
  /** The explanation is a name worth matching (not a count). */
  matchDetail: boolean;
}

function candidates(key: FilterKey, sources: FilterValueSources, t: TFunction): Candidate[] {
  switch (key) {
    case 'tag':
      return sources.tags.map((tag) => ({
        value: tag.tag,
        detail: t('search.filters.tagCount', { count: tag.count }),
        matchDetail: false,
      }));
    case 'folder':
      return sources.folders.map((folder) => ({ value: folder, detail: null, matchDetail: false }));
    case 'type':
      return TYPE_VALUES.map((value) => ({
        value,
        detail: t(`properties.values.type.${value}`),
        matchDetail: true,
      }));
    case 'due':
      return DUE_FILTER_VALUES.map((value) => ({
        value,
        detail: t(`search.filters.due.${value}`),
        matchDetail: true,
      }));
    case 'class':
      return CLASS_FILTER_VALUES.map((value) => ({
        value,
        detail: t(`search.filters.class.${value}`),
        matchDetail: true,
      }));
  }
}

export function filterSuggestions(
  token: FilterToken,
  sources: FilterValueSources,
  t: TFunction,
  limit = MAX_FILTER_SUGGESTIONS,
): FilterSuggestion[] {
  const typed = foldText(token.value.trim().replace(/^#+/, ''));
  const all = candidates(token.key, sources, t);
  // A value typed in full (or pre-filled from a tag pill) is done: Enter should open the first
  // result, not complete it again.
  if (typed !== '' && all.some((candidate) => foldText(candidate.value) === typed)) return [];
  const ranked: Array<{ rank: number; suggestion: FilterSuggestion }> = [];
  for (const candidate of all) {
    const value = foldText(candidate.value);
    const detail = candidate.matchDetail && candidate.detail ? foldText(candidate.detail) : '';
    let rank = -1;
    if (value.startsWith(typed)) rank = 0;
    else if (value.includes(typed) || detail.includes(typed)) rank = 1;
    if (rank < 0) continue;
    const { value: raw, detail: text } = candidate;
    ranked.push({ rank, suggestion: { key: token.key, value: raw, detail: text } });
  }
  // Array.prototype.sort is stable: the source order is kept inside each rank.
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((entry) => entry.suggestion);
}
