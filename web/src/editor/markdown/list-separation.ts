/**
 * Two lists written one after the other with the same bullet (or the same ordered delimiter) read
 * back as one list, e.g. once the block between them is deleted. A save keeps them apart by giving
 * one of them another bullet (`-`, `*`, `+`) or delimiter (`.`, `)`): a one-character patch on
 * each of its top-level item markers, everything else untouched.
 */
import type { List } from 'mdast';
import { normalizeLineEndings } from './line-endings';
import { parseWhole } from './markdown-parser';
import type { Piece } from './save-pieces';

const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);
const LEADING_MARKER = /^[ ]{0,3}(?:([-*+])|\d{1,9}([.)]))(?:[ \t\r\n]|$)/;
const BULLETS = ['-', '*', '+'];
const DELIMITERS = ['.', ')'];

/**
 * Re-marks pieces `from…to` (the ones being written) where one would continue the list of its
 * neighbour. The piece being re-serialised is preferred, else the later of the two. A verbatim
 * block is never re-marked: its bytes are its content.
 */
export function separateAdjacentLists(pieces: Piece[], from: number, to: number): void {
  for (let k = Math.max(from - 1, 0); k <= to && k + 1 < pieces.length; k += 1) {
    const marker = listMarkerOf(pieces[k]!);
    if (marker === null || marker !== listMarkerOf(pieces[k + 1]!)) continue;
    const candidates = [k, k + 1].filter(
      (i) => i >= from && i <= to && pieces[i]!.node.type.name !== 'verbatimBlock',
    );
    const victim = candidates.find((i) => pieces[i]!.match.kind === 'changed') ?? candidates.at(-1);
    if (victim === undefined) continue;
    const taken = new Set([marker, ...[pieces[victim - 1], pieces[victim + 1]].map(markerNear)]);
    const replacement = (DELIMITERS.includes(marker) ? DELIMITERS : BULLETS).find(
      (choice) => !taken.has(choice),
    );
    const piece = pieces[victim]!;
    const patched = replacement ? remarked(indentOf(piece.gap), piece.text, replacement) : null;
    if (patched !== null) piece.text = patched;
  }
}

function markerNear(piece: Piece | undefined): string | null {
  return piece ? listMarkerOf(piece) : null;
}

/** The bullet or delimiter of a piece written as a list (a verbatim block may hold one too). */
function listMarkerOf(piece: Piece): string | null {
  const name = piece.node.type.name;
  if (!LISTS.has(name) && name !== 'verbatimBlock') return null;
  const match = LEADING_MARKER.exec(piece.text);
  const marker = match ? (match[1] ?? match[2] ?? null) : null;
  if (marker === null || LISTS.has(name)) return marker;
  return topLevelList(indentOf(piece.gap), piece.text) ? marker : null;
}

/** The text with every top-level item marker of its list changed to `marker`; null if no list. */
function remarked(indent: string, text: string, marker: string): string | null {
  const parsed = topLevelList(indent, text);
  if (!parsed) return null;
  const { list, normalized } = parsed;
  let out = indent + text;
  for (const item of [...list.children].reverse()) {
    const start = item.position?.start.offset ?? -1;
    const digits = list.ordered ? (/^\d{1,9}/.exec(normalized.text.slice(start))?.[0] ?? '') : '';
    const at = normalized.toOriginal(start + digits.length);
    if (start < 0 || !/[-*+.)]/.test(out.charAt(at))) return null;
    out = out.slice(0, at) + marker + out.slice(at + 1);
  }
  return out.slice(indent.length);
}

function topLevelList(indent: string, text: string) {
  const normalized = normalizeLineEndings(indent + text);
  const root = parseWhole(normalized.text);
  const list = root.children[0];
  return root.children.length === 1 && list?.type === 'list'
    ? { list: list as List, normalized }
    : null;
}

function indentOf(gap: string): string {
  return /[ \t]*$/.exec(gap)?.[0] ?? '';
}
