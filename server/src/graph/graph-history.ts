/**
 * `GET /api/graph/history` (SPEC F24.1): when each node and edge of the brain map existed, from
 * the replayed event log (`graph-history-state.ts`) checked against the live index. Nodes are
 * drawn by the same rules as `buildGraph`: notes of drawn classes, plus sources (attachments, raw
 * sources) while a drawn note links to them; templates and control docs never appear. One entry
 * per lifetime: an id appears again when a note was deleted and came back. Instants are epoch ms;
 * `removedAt` is absent while the node or edge still exists.
 */
import { startOfWeekMonday, toLocalDate } from '../lib/local-date.js';
import { classifyPath, noteTitleFromPath } from '../markdown/content-classes.js';
import type { ContentClass } from '../markdown/markdown-types.js';
import {
  drawOf,
  effectiveLinks,
  effectiveSpans,
  lastPath,
  piecesOf,
  push,
  type Draw,
  type EffectiveSpans,
  type LiveGraphFacts,
  type Occupant,
  type Piece,
} from './graph-history-pieces.js';
import { BEFORE_LOG, OPEN, type LogState, type NoteIdentity } from './graph-history-state.js';
import { intersectIntervals, unionIntervals, type Interval } from './graph-intervals.js';
import { groupOf, type GraphGroup, type GraphView } from './vault-graph.js';

export interface GraphHistoryNode {
  /** Current path (a deleted note: the path it last had). */
  id: string;
  kind: 'note' | 'source';
  firstSeen: number;
  removedAt?: number;
  /** Only for ids not on the live map, so the client can draw them. */
  title?: string;
  group?: GraphGroup;
  class?: ContentClass;
}

export interface GraphHistoryEdge {
  /** The smaller id of the pair (edges are undirected, like the live map). */
  from: string;
  to: string;
  addedAt: number;
  removedAt?: number;
}

export interface GraphHistory {
  /** Monday (local) of the week of the earliest event, or null when the log is empty. */
  firstWeek: string | null;
  /** Monday (local) of the current week. */
  currentWeek: string;
  /** Exact history starts here; before it, creation times are estimates. */
  exactSince: number | null;
  nodes: GraphHistoryNode[];
  edges: GraphHistoryEdge[];
}

export interface LiveGraphInput extends LiveGraphFacts {
  graph: GraphView;
  /** Resolved links of every indexed note (`GraphRows.links`). */
  links: readonly { from: string; to: string }[];
}

const byText = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

function weekOf(instant: number): string {
  return startOfWeekMonday(toLocalDate(new Date(instant)));
}

export function buildGraphHistory(state: LogState, live: LiveGraphInput, now: Date): GraphHistory {
  const nowMs = now.getTime();
  const start = state.firstTs ?? nowMs;
  const liveLinks = new Map<string, string[]>();
  for (const { from, to } of live.links) push(liveLinks, from, to);

  const occupancy = new Map<string, Occupant[]>();
  const noteSpans = new Map<string, Interval[]>();
  const spansOf = new Map<NoteIdentity, EffectiveSpans>();
  for (const identity of state.identities) {
    const spans = effectiveSpans(identity, start, nowMs, live);
    spansOf.set(identity, spans);
    const id = lastPath(identity);
    for (const s of spans) {
      const draw = drawOf(s.path);
      push(occupancy, s.path, { identity, span: { from: s.from, to: s.to }, draw });
      if (draw === 'note') push(noteSpans, id, { from: s.from, to: s.to });
    }
  }

  const pieces: Piece[] = [];
  for (const identity of state.identities) {
    const spans = spansOf.get(identity) ?? [];
    const current = state.alive.get(lastPath(identity)) === identity ? lastPath(identity) : null;
    const links = effectiveLinks(identity, current, liveLinks);
    piecesOf(identity, spans, links, occupancy, live.files, pieces);
  }

  // A source exists while a drawn note links to it.
  const sourceSpans = new Map<string, Interval[]>();
  for (const p of pieces)
    if (p.aDraw === 'note' && p.bDraw === 'source') push(sourceSpans, p.b, p.span);
  const sourcePresence = new Map<string, Interval[]>();
  for (const [id, spans] of sourceSpans) sourcePresence.set(id, unionIntervals(spans));

  const ALWAYS = [{ from: BEFORE_LOG, to: OPEN }];
  const presenceFor = (id: string, draw: Draw) =>
    draw === 'note' ? ALWAYS : (sourcePresence.get(id) ?? []);
  const pairs = new Map<string, { from: string; to: string; spans: Interval[] }>();
  for (const p of pieces) {
    const both = intersectIntervals(presenceFor(p.a, p.aDraw), presenceFor(p.b, p.bDraw));
    const spans = intersectIntervals([p.span], both);
    if (spans.length === 0) continue;
    const [from, to] = p.a < p.b ? [p.a, p.b] : [p.b, p.a];
    const key = `${from}\u0000${to}`;
    const pair = pairs.get(key) ?? { from, to, spans: [] };
    pair.spans.push(...spans);
    pairs.set(key, pair);
  }

  const liveIds = new Set(live.graph.nodes.map((n) => n.id));
  const nodes: GraphHistoryNode[] = [];
  const emit = (id: string, kind: 'note' | 'source', spans: Interval[]) => {
    const extra = liveIds.has(id)
      ? {}
      : { title: noteTitleFromPath(id), group: groupOf(id), class: classifyPath(id) };
    for (const s of unionIntervals(spans)) {
      nodes.push({
        id,
        kind,
        firstSeen: s.from,
        ...(s.to === OPEN ? {} : { removedAt: s.to }),
        ...extra,
      });
    }
  };
  for (const [id, spans] of noteSpans) emit(id, 'note', spans);
  for (const [id, spans] of sourcePresence) emit(id, 'source', spans);
  nodes.sort((x, y) => byText(x.id, y.id) || x.firstSeen - y.firstSeen);

  const edges: GraphHistoryEdge[] = [];
  for (const pair of pairs.values()) {
    for (const s of unionIntervals(pair.spans)) {
      edges.push({
        from: pair.from,
        to: pair.to,
        addedAt: s.from,
        ...(s.to === OPEN ? {} : { removedAt: s.to }),
      });
    }
  }
  edges.sort((x, y) => byText(x.from, y.from) || byText(x.to, y.to) || x.addedAt - y.addedAt);

  const currentWeek = weekOf(nowMs);
  const firstWeek = state.firstTs === null ? null : weekOf(Math.min(state.firstTs, nowMs));
  return { firstWeek, currentWeek, exactSince: state.exactSince, nodes, edges };
}
