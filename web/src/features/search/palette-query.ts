/**
 * Reading the palette input: `>` switches to commands; a filter being typed at the end
 * (`tag:đồ`, `folder:"1 Pro`) gets value suggestions. Tokens follow the server's search parser:
 * whitespace separates them and a `key:"…"` value may contain spaces.
 */
export const COMMAND_PREFIX = '>';

export const FILTER_KEYS = ['tag', 'folder', 'type', 'due', 'class'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

const FILTER_TOKEN = /^(tag|folder|type|due|class):/i;
const ANY_FILTER = /(^|\s)(tag|folder|type|due|class):/i;

/** The text after `>` in command mode, or null for a note search. */
export function commandText(query: string): string | null {
  const trimmed = query.trimStart();
  return trimmed.startsWith(COMMAND_PREFIX) ? trimmed.slice(COMMAND_PREFIX.length).trim() : null;
}

/** The query uses a filter (`tag:` …): it is not a note name and names no command. */
export function hasFilter(query: string): boolean {
  return ANY_FILTER.test(query);
}

export interface FilterToken {
  key: FilterKey;
  /** What is typed after `key:` (without an opening quote). */
  value: string;
  /** Index of the token in the query. */
  start: number;
}

const isSpace = (char: string) => /\s/u.test(char);

/** The filter token still being typed at the end of the query, or null. */
export function activeFilterToken(query: string): FilterToken | null {
  let i = 0;
  while (i < query.length) {
    while (i < query.length && isSpace(query.charAt(i))) i += 1;
    if (i >= query.length) return null;
    const start = i;
    const match = FILTER_TOKEN.exec(query.slice(i));
    const key = match?.[1]?.toLowerCase() as FilterKey | undefined;
    const valueStart = i + (match?.[0].length ?? 0);
    if (key && query.charAt(valueStart) === '"') {
      const close = query.indexOf('"', valueStart + 1);
      // An open quote runs to the end: the value is still being typed.
      if (close === -1) return { key, value: query.slice(valueStart + 1), start };
      i = close + 1;
      continue;
    }
    while (i < query.length && !isSpace(query.charAt(i))) i += 1;
    if (i >= query.length) return key ? { key, value: query.slice(valueStart), start } : null;
  }
  return null;
}

/** `key:value` as the server reads it (quoted when the value has a space). */
export function filterText(key: FilterKey, value: string): string {
  return /\s/u.test(value) ? `${key}:"${value}"` : `${key}:${value}`;
}

/** The query with the token being typed replaced by `key:value` and a space to go on typing. */
export function completeFilter(query: string, token: FilterToken, value: string): string {
  return `${query.slice(0, token.start)}${filterText(token.key, value)} `;
}
