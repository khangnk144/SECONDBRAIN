/**
 * Internal result of the Markdown structure pass, produced by either the fast line scanner or
 * the full remark parse. Everything `parseNote` reports is derived from this plus raw-text
 * scans, so both producers must agree on these fields exactly. All offsets are UTF-16 offsets
 * into the whole file content.
 */

export interface TextSpan {
  start: number;
  end: number;
}

/** An inline Markdown link or image (`[text](url)`, `![alt](url)`). */
export interface StructureLink extends TextSpan {
  /** Destination with escapes and character references decoded; may still be percent-encoded. */
  url: string;
}

export interface StructureTask {
  /** Offset of the `[` of the GFM checkbox. */
  checkbox: number;
  checked: boolean;
}

export interface StructureHeading {
  depth: number;
  /** Offset where the heading starts (its first content line for setext headings). */
  start: number;
  /** Text content (inline syntax removed, wikilinks replaced by alias or target). */
  text: string;
}

export interface NoteStructure {
  /** Code (fenced, indented, inline) and raw HTML (block, inline), sorted, non-overlapping. */
  excluded: TextSpan[];
  links: StructureLink[];
  tasks: StructureTask[];
  headings: StructureHeading[];
  /** Text content of each block in document order (see `PlainTextBuilder`). */
  blocks: string[];
}

/** Sorts spans and merges overlapping or touching ones. */
export function mergeSpans(spans: TextSpan[]): TextSpan[] {
  if (spans.length < 2) return spans;
  spans.sort((a, b) => a.start - b.start);
  const merged: TextSpan[] = [spans[0] as TextSpan];
  for (let i = 1; i < spans.length; i += 1) {
    const span = spans[i] as TextSpan;
    const last = merged[merged.length - 1] as TextSpan;
    if (span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}
