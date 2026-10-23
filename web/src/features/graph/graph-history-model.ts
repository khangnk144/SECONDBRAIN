/**
 * The time scrubber's data (SPEC F24.1): `GET /graph/history` compiled once into typed arrays,
 * then, per week, the map as it was at the END of that week (local Monday 00:00 of the next week,
 * exclusive): an entry counts when `firstSeen < end ≤ removedAt` (or it was never removed). The
 * last week is the current one: the screen shows the live map there. A step costs one pass over
 * the entries, O(nodes + edges).
 */
import type { GraphHistoryResponse } from '../../lib/api/graph-history-types';
import type { GraphEdge, GraphNode, GraphResponse } from '../../lib/api/graph-types';
import { isoAddDays } from '../../lib/local-day';
import { baseName } from '../../lib/vault-paths';

/** At most 20 years of weeks (a `created: 1999-…` front matter must not make 1,400 steps). */
export const MAX_WEEKS = 1_044;

export interface CompiledHistory {
  /** Mondays (`YYYY-MM-DD`), oldest first; the last one is the current week. */
  weeks: string[];
  /** `weekEnds[w]` = local midnight of the Monday after `weeks[w]` (epoch ms). */
  weekEnds: number[];
  ids: string[];
  idIndex: Map<string, number>;
  nodeId: Int32Array;
  nodeFrom: Float64Array;
  nodeTo: Float64Array;
  nodeSource: Uint8Array;
  edgeA: Int32Array;
  edgeB: Int32Array;
  edgeFrom: Float64Array;
  edgeTo: Float64Array;
  /** How to draw ids that are not on the live map. */
  info: Map<string, Pick<GraphNode, 'title' | 'group' | 'class'>>;
  exactSince: number | null;
}

function localMidnight(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime();
}

/** Mondays from `first` to `last` (inclusive), at most `MAX_WEEKS` (the most recent ones). */
export function weekList(first: string, last: string): string[] {
  const weeks: string[] = [];
  let monday = last;
  while (weeks.length < MAX_WEEKS && monday >= first) {
    weeks.push(monday);
    monday = isoAddDays(monday, -7);
  }
  return weeks.reverse();
}

export function compileHistory(history: GraphHistoryResponse): CompiledHistory | null {
  if (!history.firstWeek || history.firstWeek > history.currentWeek) return null;
  const weeks = weekList(history.firstWeek, history.currentWeek);
  const ids: string[] = [];
  const idIndex = new Map<string, number>();
  const indexOf = (id: string) => {
    let index = idIndex.get(id);
    if (index === undefined) {
      index = ids.length;
      ids.push(id);
      idIndex.set(id, index);
    }
    return index;
  };
  const info: CompiledHistory['info'] = new Map();
  const nodes = history.nodes;
  const nodeId = new Int32Array(nodes.length);
  const nodeFrom = new Float64Array(nodes.length);
  const nodeTo = new Float64Array(nodes.length);
  const nodeSource = new Uint8Array(nodes.length);
  nodes.forEach((node, k) => {
    nodeId[k] = indexOf(node.id);
    nodeFrom[k] = node.firstSeen;
    nodeTo[k] = node.removedAt ?? Number.POSITIVE_INFINITY;
    nodeSource[k] = node.kind === 'source' ? 1 : 0;
    if (node.title !== undefined && !info.has(node.id)) {
      info.set(node.id, {
        title: node.title,
        group: node.group ?? 'other',
        class: node.class ?? (node.kind === 'source' ? 'attachment' : 'user'),
      });
    }
  });
  const edges = history.edges;
  const edgeA = new Int32Array(edges.length);
  const edgeB = new Int32Array(edges.length);
  const edgeFrom = new Float64Array(edges.length);
  const edgeTo = new Float64Array(edges.length);
  edges.forEach((edge, k) => {
    edgeA[k] = indexOf(edge.from);
    edgeB[k] = indexOf(edge.to);
    edgeFrom[k] = edge.addedAt;
    edgeTo[k] = edge.removedAt ?? Number.POSITIVE_INFINITY;
  });
  const weekEnds = weeks.map((monday) => localMidnight(isoAddDays(monday, 7)));
  return {
    weeks,
    weekEnds,
    ids,
    idIndex,
    nodeId,
    nodeFrom,
    nodeTo,
    nodeSource,
    edgeA,
    edgeB,
    edgeFrom,
    edgeTo,
    info,
    exactSince: history.exactSince,
  };
}

export interface WeekSnapshot {
  /** By id index: 0 absent, 1 note, 2 source. */
  present: Uint8Array;
  /** Edge entries that existed (both ends present), one per pair. */
  edges: number[];
}

/** What existed at the end of week `w`. */
export function weekSnapshot(history: CompiledHistory, w: number): WeekSnapshot {
  const end = history.weekEnds[w] ?? Number.POSITIVE_INFINITY;
  const present = new Uint8Array(history.ids.length);
  for (let k = 0; k < history.nodeId.length; k++) {
    if ((history.nodeFrom[k] ?? 0) < end && (history.nodeTo[k] ?? 0) >= end) {
      present[history.nodeId[k] ?? 0] = history.nodeSource[k] ? 2 : 1;
    }
  }
  const seen = new Set<number>();
  const edges: number[] = [];
  const count = history.ids.length;
  for (let k = 0; k < history.edgeA.length; k++) {
    const a = history.edgeA[k] ?? 0;
    const b = history.edgeB[k] ?? 0;
    if (!((history.edgeFrom[k] ?? 0) < end && (history.edgeTo[k] ?? 0) >= end)) continue;
    if (a === b || !present[a] || !present[b]) continue;
    const key = Math.min(a, b) * count + Math.max(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(k);
  }
  return { present, edges };
}

/**
 * The map of week `w` in the shape of `GET /graph`: live nodes keep their data (and filter
 * facts), nodes only the history knows are drawn from its info; degrees are that week's.
 */
export function weekResponse(
  history: CompiledHistory,
  w: number,
  live: GraphResponse,
): GraphResponse {
  const { present, edges: entries } = weekSnapshot(history, w);
  const liveById = new Map(live.nodes.map((node) => [node.id, node]));
  const degree = new Uint32Array(history.ids.length);
  const edges: GraphEdge[] = entries.map((k) => {
    const a = history.edgeA[k] ?? 0;
    const b = history.edgeB[k] ?? 0;
    degree[a] = (degree[a] ?? 0) + 1;
    degree[b] = (degree[b] ?? 0) + 1;
    return { source: history.ids[a] ?? '', target: history.ids[b] ?? '' };
  });
  const nodes: GraphNode[] = [];
  history.ids.forEach((id, i) => {
    const kind = present[i];
    if (!kind) return;
    const count = degree[i] ?? 0;
    const known = liveById.get(id);
    const extra = history.info.get(id);
    const base: GraphNode = known ?? {
      id,
      title: extra?.title ?? baseName(id).replace(/\.md$/i, ''),
      kind: kind === 2 ? 'source' : 'note',
      class: extra?.class ?? (kind === 2 ? 'attachment' : 'user'),
      group: extra?.group ?? 'other',
      degree: 0,
      orphan: true,
    };
    nodes.push({
      ...base,
      kind: kind === 2 ? 'source' : 'note',
      degree: count,
      orphan: count === 0,
    });
  });
  return { nodes, edges };
}

/** "n ghi chú, m liên kết" of a map: notes (not sources) and edges. */
export function mapCounts(response: Pick<GraphResponse, 'nodes' | 'edges'>) {
  return {
    notes: response.nodes.filter((node) => node.kind === 'note').length,
    links: response.edges.length,
  };
}
