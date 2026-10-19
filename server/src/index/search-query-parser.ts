/**
 * Splits a search box query into filter tokens (`tag:` `folder:` `type:` `due:` `class:`) and
 * free text. Values may be quoted (`folder:"2 Areas"`). Anything that is not a recognised filter
 * stays free text, so the user never loses words to a typo like `tga:x`.
 */
import type { SearchQuery } from './index-types.js';

export type DueFilter = '7d' | '30d' | 'overdue';

export interface ParsedSearch {
  /** Free text with filter tokens removed (raw; the FTS layer normalizes it). */
  text: string;
  /** Every tag filter must match (AND); each also matches nested tags `tag/child`. */
  tags: string[];
  folder: string | null;
  type: string | null;
  due: DueFilter | null;
  includeArchive: boolean;
  limit: number;
}

export const DEFAULT_SEARCH_LIMIT = 50;
export const MAX_SEARCH_LIMIT = 200;

const FILTER_TOKEN = /^(tag|folder|type|due|class):/i;
const DUE_VALUES = new Set<string>(['7d', '30d', 'overdue']);

interface RawToken {
  text: string;
  key: string | null;
  value: string;
}

/** Whitespace-separated tokens; a `key:"…"` value may contain spaces (closing quote optional). */
function tokenize(q: string): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;
  while (i < q.length) {
    while (i < q.length && /\s/u.test(q.charAt(i))) i += 1;
    if (i >= q.length) break;
    const start = i;
    const filter = FILTER_TOKEN.exec(q.slice(i));
    if (filter && q.charAt(i + filter[0].length) === '"') {
      const valueStart = i + filter[0].length + 1;
      const close = q.indexOf('"', valueStart);
      const valueEnd = close === -1 ? q.length : close;
      i = close === -1 ? q.length : close + 1;
      const key = filter[1]?.toLowerCase() ?? null;
      tokens.push({ text: q.slice(start, i), key, value: q.slice(valueStart, valueEnd) });
      continue;
    }
    while (i < q.length && !/\s/u.test(q.charAt(i))) i += 1;
    const text = q.slice(start, i);
    tokens.push({
      text,
      key: filter?.[1]?.toLowerCase() ?? null,
      value: filter ? text.slice(filter[0].length) : '',
    });
  }
  return tokens;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_SEARCH_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_SEARCH_LIMIT);
}

const cleanTag = (value: string): string => value.trim().replace(/^#+/, '').replace(/\/+$/, '');
const cleanFolder = (value: string): string => value.trim().replace(/^\/+|\/+$/g, '');

export function parseSearchQuery(query: SearchQuery): ParsedSearch {
  const parsed: ParsedSearch = {
    text: '',
    tags: [],
    folder: query.folder ? cleanFolder(query.folder) || null : null,
    type: query.type?.trim() || null,
    due: query.due && DUE_VALUES.has(query.due) ? query.due : null,
    includeArchive: query.class === 'archive',
    limit: clampLimit(query.limit),
  };
  if (query.tag && cleanTag(query.tag)) parsed.tags.push(cleanTag(query.tag));
  const free: string[] = [];
  for (const token of tokenize(query.q ?? '')) {
    const value = token.value.trim();
    // A filter key with nothing after it is a filter being typed: it must not search the key.
    if (token.key && value === '') continue;
    if (token.key === 'tag' && cleanTag(value)) parsed.tags.push(cleanTag(value));
    else if (token.key === 'folder' && cleanFolder(value)) parsed.folder = cleanFolder(value);
    else if (token.key === 'type') parsed.type = value;
    else if (token.key === 'due' && DUE_VALUES.has(value.toLowerCase()))
      parsed.due = value.toLowerCase() as DueFilter;
    else if (token.key === 'class' && value.toLowerCase() === 'archive')
      parsed.includeArchive = true;
    else free.push(token.text);
  }
  parsed.text = free.join(' ');
  return parsed;
}

export function hasFilters(parsed: ParsedSearch): boolean {
  return (
    parsed.tags.length > 0 || parsed.folder !== null || parsed.type !== null || parsed.due !== null
  );
}
