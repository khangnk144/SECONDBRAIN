import { foldText } from '../../lib/fold-text';
import type { GraphModel, GraphModelNode } from './graph-model';

/** Matches listed at once in the side panel; typing more narrows the rest down. */
export const MAX_SEARCH_RESULTS = 50;

export interface GraphSearchResult {
  results: GraphModelNode[];
  /** All matches, including those beyond `MAX_SEARCH_RESULTS`. */
  total: number;
}

/**
 * Nodes whose title contains the query, ignoring case and diacritics ("giai tich" finds
 * "Giải tích 1"). Titles that start with the query come first, then bigger hubs, then by title.
 */
export function searchGraphNodes(model: GraphModel | null, query: string): GraphSearchResult {
  const folded = foldText(query).trim();
  if (!model || folded === '') return { results: [], total: 0 };
  const matches = model.nodes.filter((node) => node.searchText.includes(folded));
  matches.sort((a, b) => {
    const prefix =
      Number(b.searchText.startsWith(folded)) - Number(a.searchText.startsWith(folded));
    return prefix || b.degree - a.degree || a.title.localeCompare(b.title);
  });
  return { results: matches.slice(0, MAX_SEARCH_RESULTS), total: matches.length };
}
