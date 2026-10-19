import { api } from '../api';
import { withQuery } from './query-string';
import type { SearchParams, SearchResponse, TagsResponse } from './search-types';

/** Titles first, then full text; an empty query returns the most recently modified notes. */
export function getSearch(params: SearchParams): Promise<SearchResponse> {
  return api().get<SearchResponse>(withQuery('/search', { ...params }));
}

export function getTags(): Promise<TagsResponse> {
  return api().get<TagsResponse>('/tags');
}
