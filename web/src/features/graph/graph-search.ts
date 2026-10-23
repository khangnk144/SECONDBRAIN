import { foldText } from '../../lib/fold-text';
import type { GraphModel, GraphModelNode } from './graph-model';

/** Matches listed at once in the side panel; typing more narrows the rest down. */
export const MAX_SEARCH_RESULTS = 50;

export interface GraphSearchResult {
  results: GraphModelNode[];
  /** All matches, including those beyond `MAX_SEARCH_RESULTS`. */
  total: number;
}

const passes = (match: Uint8Array | null | undefined, node: GraphModelNode) =>
  !match || match[node.i] === 1;

/**
 * Nodes whose title contains the query, ignoring case and diacritics ("giai tich" finds
 * "Giải tích 1"). Titles that start with the query come first, then bigger hubs, then by title.
 * With a filter (`match[i]` = 1 for matching nodes) only matching nodes are found (F24.2).
 */
export function searchGraphNodes(
  model: GraphModel | null,
  query: string,
  match?: Uint8Array | null,
): GraphSearchResult {
  const folded = foldText(query).trim();
  if (!model || folded === '') return { results: [], total: 0 };
  const matches = model.nodes.filter(
    (node) => node.searchText.includes(folded) && passes(match, node),
  );
  matches.sort((a, b) => {
    const prefix =
      Number(b.searchText.startsWith(folded)) - Number(a.searchText.startsWith(folded));
    return prefix || b.degree - a.degree || a.title.localeCompare(b.title);
  });
  return { results: matches.slice(0, MAX_SEARCH_RESULTS), total: matches.length };
}

/** Every node a filter keeps, by title (the side panel's list while the search box is empty). */
export function filteredGraphNodes(model: GraphModel | null, match: Uint8Array): GraphSearchResult {
  if (!model) return { results: [], total: 0 };
  const matches = model.nodes.filter((node) => match[node.i] === 1);
  matches.sort((a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1));
  return { results: matches.slice(0, MAX_SEARCH_RESULTS), total: matches.length };
}
