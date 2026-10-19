/**
 * Unlinked mentions of a note title (SPEC F5): occurrences of the title as plain text,
 * case-insensitive and NFC-insensitive, that no letter or digit continues on either side, outside
 * code, HTML, existing links (wikilinks, embeds, Markdown links), URLs and the front matter.
 * Offsets are UTF-16 offsets into the content as given (which may be NFD on disk).
 */
import type { NoteStructure, TextSpan } from './note-structure-types.js';
import { mergeSpans } from './note-structure-types.js';
import { noteStructure } from './note-structure.js';
import { parseNoteUsing } from './parse-note.js';
import { splitFrontmatter } from './frontmatter.js';

export interface TitleMention {
  start: number;
  end: number;
}

interface CaseFolded {
  folded: string;
  /** `map[i]` = content offset of the cluster that produced `folded[i]`; one extra entry at the end. */
  map: number[];
}

const MARK = /^\p{M}$/u;
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const AUTOLINK = /<[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*>|<[^\s<>@]+@[^\s<>]+>/g;
const BARE_URL = /(?:\b[a-zA-Z][a-zA-Z0-9+.-]{1,31}:\/\/|\bwww\.)[^\s<>]*/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

function codePointLength(text: string, at: number): number {
  const code = text.charCodeAt(at);
  return code >= 0xd800 && code <= 0xdbff && at + 1 < text.length ? 2 : 1;
}

function isMarkAt(text: string, at: number): boolean {
  const code = text.charCodeAt(at);
  if (code >= 0x300 && code <= 0x36f) return true;
  return code > 0x36f && MARK.test(text.slice(at, at + codePointLength(text, at)));
}

/** NFC + lowercase per cluster (a base character and its combining marks), keeping offsets. */
function foldCase(text: string): CaseFolded {
  const pieces: string[] = [];
  const map: number[] = [];
  for (let at = 0; at < text.length;) {
    const start = at;
    at += codePointLength(text, at);
    while (at < text.length && isMarkAt(text, at)) at += codePointLength(text, at);
    const cluster = text.slice(start, at);
    const piece =
      cluster.length === 1 && cluster < '\u0080'
        ? cluster.toLowerCase()
        : cluster.normalize('NFC').toLowerCase();
    for (let k = 0; k < piece.length; k += 1) map.push(start);
    pieces.push(piece);
  }
  map.push(text.length);
  return { folded: pieces.join(''), map };
}

/** Code, HTML, links, URLs and the front matter: where a mention never counts. */
function excludedSpans(content: string): TextSpan[] {
  let structure: NoteStructure | null = null;
  const parsed = parseNoteUsing(content, (text, bodyStart) => {
    structure = noteStructure(text, bodyStart);
    return structure;
  });
  const spans: TextSpan[] = [{ start: 0, end: splitFrontmatter(content).bodyStart }];
  for (const span of (structure as NoteStructure | null)?.excluded ?? []) spans.push({ ...span });
  for (const link of parsed.links) spans.push({ start: link.start, end: link.end });
  for (const pattern of [AUTOLINK, BARE_URL, EMAIL]) {
    for (const match of content.matchAll(pattern)) {
      spans.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return mergeSpans(spans);
}

const isWordCharAt = (text: string, offset: number) =>
  offset >= 0 &&
  offset < text.length &&
  WORD_CHAR.test(String.fromCodePoint(text.codePointAt(offset)!));

/** Code point index just before `offset` (handles surrogate pairs). */
function previousCharOffset(text: string, offset: number): number {
  const low = text.charCodeAt(offset - 1);
  return low >= 0xdc00 && low <= 0xdfff && offset >= 2 ? offset - 2 : offset - 1;
}

export function findTitleMentions(content: string, title: string): TitleMention[] {
  const needle = foldCase(title).folded;
  if (needle.trim() === '') return [];
  const startsWithWord = WORD_CHAR.test([...title][0] ?? '');
  const endsWithWord = WORD_CHAR.test([...title].at(-1) ?? '');
  const { folded, map } = foldCase(content);
  const excluded = excludedSpans(content);
  const mentions: TitleMention[] = [];
  let span = 0;
  let lastEnd = 0;
  for (let at = folded.indexOf(needle); at !== -1; at = folded.indexOf(needle, at + 1)) {
    const after = at + needle.length;
    // The match must cover whole clusters, or it is part of a longer character.
    if (
      (at > 0 && map[at] === map[at - 1]) ||
      (after < folded.length && map[after] === map[after - 1])
    ) {
      continue;
    }
    const [start, end] = [map[at]!, map[after]!];
    if (start < lastEnd) continue;
    if (startsWithWord && start > 0 && isWordCharAt(content, previousCharOffset(content, start))) {
      continue;
    }
    if (endsWithWord && isWordCharAt(content, end)) continue;
    while (span < excluded.length && excluded[span]!.end <= start) span += 1;
    if (span < excluded.length && excluded[span]!.start < end) continue;
    mentions.push({ start, end });
    lastEnd = end;
  }
  return mentions;
}
