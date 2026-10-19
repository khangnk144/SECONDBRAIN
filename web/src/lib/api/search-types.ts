/** `GET /api/search` and `GET /api/tags`, mirrored from `server/src/index/index-types.ts`. */
import type { ContentClass, VaultPath } from './vault-types';

export interface SearchParams {
  /** Free text; may also contain filter tokens `tag:` `folder:` `type:` `due:` `class:`. */
  q?: string;
  tag?: string;
  folder?: string;
  type?: string;
  due?: '7d' | '30d' | 'overdue';
  class?: 'archive';
  limit?: number;
}

export interface SearchSnippet {
  /** Excerpt of the original text (diacritics intact). */
  text: string;
  /** [start, end) UTF-16 ranges inside `text` matching query terms. */
  highlights: [number, number][];
}

export interface SearchResult {
  path: VaultPath;
  title: string;
  folder: string;
  class: ContentClass;
  matchedIn: 'title' | 'body' | 'filter' | 'recent';
  snippet: SearchSnippet | null;
  score: number;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface TagCount {
  /** Display form (the first spelling seen). */
  tag: string;
  norm: string;
  /** Number of notes carrying the tag. */
  count: number;
}

export interface TagsResponse {
  tags: TagCount[];
}
