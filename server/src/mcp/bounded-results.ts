/**
 * Every tool result stays small enough for the model's context, however large the vault grows:
 * long texts come in parts (`nextOffset`), long lists are capped with their full totals.
 */

/** Characters of note text one `read_note` call returns (the same budget as `read_source`). */
export const READ_NOTE_MAX_CHARS = 60_000;
/** Entries per list in `wiki_lint` (the `counts` object has the full totals). */
export const LINT_LIST_MAX = 100;
export const LIST_NOTES_DEFAULT = 200;
export const SEARCH_DEFAULT = 20;

export interface TextPart {
  content: string;
  truncated: boolean;
  /** Where the next call continues (UTF-16 offset), null when this part reaches the end. */
  nextOffset: number | null;
  totalLength: number;
}

/** `text` from `offset`, at most `max` UTF-16 units, never splitting a surrogate pair. */
export function textPart(text: string, offset: number, max = READ_NOTE_MAX_CHARS): TextPart {
  let end = Math.min(text.length, offset + max);
  const code = text.charCodeAt(end - 1);
  if (end < text.length && end - 1 > offset && code >= 0xd800 && code <= 0xdbff) end -= 1;
  return {
    content: text.slice(offset, end),
    truncated: offset > 0 || end < text.length,
    nextOffset: end < text.length ? end : null,
    totalLength: text.length,
  };
}

/** The first `max` entries of each list, plus how many each list really has. */
export function capLists<T extends Record<string, unknown[]>>(
  lists: T,
  max = LINT_LIST_MAX,
): T & { counts: { [K in keyof T]: number } } {
  const capped = {} as Record<string, unknown[]>;
  const counts = {} as Record<string, number>;
  for (const [name, list] of Object.entries(lists)) {
    capped[name] = list.slice(0, max);
    counts[name] = list.length;
  }
  return { ...(capped as T), counts: counts as { [K in keyof T]: number } };
}
