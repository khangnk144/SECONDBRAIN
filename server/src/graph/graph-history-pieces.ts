/**
 * The building blocks of the graph history (SPEC F24.1): which paths the map draws, where each
 * note identity lived as the live index confirms it, and the "pieces" of time during which one
 * node linked another (a link resolved against whichever note lived at its target path then).
 */
import { CLASS_RULES, classifyPath, isNotePath } from '../markdown/content-classes.js';
import {
  BEFORE_LOG,
  hasOpenLink,
  OPEN,
  type LinkSpan,
  type NoteIdentity,
} from './graph-history-state.js';
import type { Interval } from './graph-intervals.js';

export interface LiveGraphFacts {
  /** Every indexed note path (any class). */
  notes: ReadonlySet<string>;
  /** Every indexed non-note file. */
  files: ReadonlySet<string>;
}

export type Draw = 'note' | 'source' | null;

export function drawOf(path: string): Draw {
  const rule = CLASS_RULES[classifyPath(path)].graphNode;
  if (rule === 'yes' || rule === 'dimmed') return 'note';
  return rule === 'linked-only' ? 'source' : null;
}

export interface Occupant {
  identity: NoteIdentity;
  span: Interval;
  draw: Draw;
}

export interface Piece {
  a: string;
  b: string;
  span: Interval;
  aDraw: Draw;
  bDraw: Draw;
}

export const lastPath = (identity: NoteIdentity) =>
  identity.spans[identity.spans.length - 1]?.path ?? '';

export function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Spans as the live index confirms them: an identity whose note is gone ends now. */
export function effectiveSpans(
  identity: NoteIdentity,
  start: number,
  now: number,
  live: LiveGraphFacts,
) {
  return identity.spans.map((s) => ({
    path: s.path,
    from: s.from === BEFORE_LOG ? start : s.from,
    to: s.to === OPEN && !live.notes.has(s.path) ? Math.max(now, s.from) : s.to,
  }));
}

/** Links plus live links the log never recorded (they existed before it began). */
export function effectiveLinks(
  identity: NoteIdentity,
  path: string | null,
  live: Map<string, string[]>,
): LinkSpan[] {
  const extra = (path === null ? [] : (live.get(path) ?? []))
    .filter((target) => !hasOpenLink(identity, target))
    .map((target) => ({ target, from: BEFORE_LOG, to: OPEN }));
  return [...identity.links, ...extra];
}

export type EffectiveSpans = ReturnType<typeof effectiveSpans>;

export function piecesOf(
  identity: NoteIdentity,
  spans: EffectiveSpans,
  linkSpans: readonly LinkSpan[],
  occupancy: Map<string, Occupant[]>,
  files: ReadonlySet<string>,
  out: Piece[],
): void {
  const a = lastPath(identity);
  for (const link of linkSpans) {
    for (const own of spans) {
      const aDraw = drawOf(own.path);
      const span = { from: Math.max(link.from, own.from), to: Math.min(link.to, own.to) };
      if (aDraw === null || span.to <= span.from) continue;
      const occupants = occupancy.get(link.target);
      if (!occupants) {
        // A file target: a source while some drawn note links to it (it exists now).
        const fileSource = !isNotePath(link.target) && drawOf(link.target) === 'source';
        if (fileSource && files.has(link.target) && link.target !== a)
          out.push({ a, b: link.target, span, aDraw, bDraw: 'source' });
        continue;
      }
      for (const o of occupants) {
        const b = lastPath(o.identity);
        const piece = { from: Math.max(span.from, o.span.from), to: Math.min(span.to, o.span.to) };
        if (o.draw === null || b === a || piece.to <= piece.from) continue;
        out.push({ a, b, span: piece, aDraw, bDraw: o.draw });
      }
    }
  }
}
