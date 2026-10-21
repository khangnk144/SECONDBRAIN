/**
 * Where a date-looking text on a task line is NOT a task date token (SPEC §4.6): code and raw
 * HTML, wikilinks and embeds (`[[Họp 📅 2026-10-22]]` names a note) and inline Markdown links and
 * images (their text and destination). The index and the task-line patcher both use this one rule,
 * so a view can only move or remove the token the index reads.
 */
import { mergeSpans, type NoteStructure, type TextSpan } from './note-structure-types.js';
import { scanWikilinks, type WikilinkHit } from './wikilink-scan.js';

const BRACKET = 91; // [
const BANG = 33; // !

/** Calls `onHit` for every body wikilink and embed outside code and HTML (`excluded`). */
export function forEachBodyWikilink(
  content: string,
  bodyStart: number,
  excluded: readonly TextSpan[],
  onHit: (hit: WikilinkHit) => void,
): void {
  let from = bodyStart;
  for (const span of excluded) {
    if (span.start > from) scanWikilinks(content, from, span.start, onHit);
    from = Math.max(from, span.end);
  }
  if (from < content.length) scanWikilinks(content, from, content.length, onHit);
}

/**
 * The masked spans for task tokens: `structure.excluded` plus `wikilinks` plus the inline links
 * and images of the structure pass. Autolinks are left out on purpose: only the full parser
 * reports them as links, and both structure producers must give the same mask.
 */
export function taskTokenMask(
  content: string,
  structure: NoteStructure,
  wikilinks: readonly TextSpan[],
): TextSpan[] {
  const spans: TextSpan[] = structure.excluded.map(({ start, end }) => ({ start, end }));
  for (const link of structure.links) {
    const first = content.charCodeAt(link.start);
    if (first === BRACKET || first === BANG) spans.push({ start: link.start, end: link.end });
  }
  for (const link of wikilinks) spans.push({ start: link.start, end: link.end });
  return mergeSpans(spans);
}

/** `taskTokenMask` with the body wikilinks found here (for callers without a link list). */
export function noteTaskTokenMask(
  content: string,
  bodyStart: number,
  structure: NoteStructure,
): TextSpan[] {
  const wikilinks: TextSpan[] = [];
  forEachBodyWikilink(content, bodyStart, structure.excluded, (hit) => {
    wikilinks.push({ start: hit.start, end: hit.end });
  });
  return taskTokenMask(content, structure, wikilinks);
}
