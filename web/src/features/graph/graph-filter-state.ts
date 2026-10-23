/**
 * What the brain map's filter bar holds (SPEC F24.2): colour groups (the legend's chips), one tag
 * and a time window, remembered per vault (`sb:<vaultId>:graph-filter`). `#/graph?when=` opens the
 * map with only that time window (the Today brain tile links to `when=today`); such a visit does
 * not overwrite what is remembered until the person changes a filter themselves.
 */
import { GRAPH_GROUPS, type GraphGroup } from '../../lib/api/graph-types';
import { isoAddDays } from '../../lib/local-day';
import { EMPTY_GRAPH_FILTER, graphFilterPredicate, type GraphFilter } from './graph-filter';
import type { GraphModel } from './graph-model';

export type GraphTimeWindow = 'all' | 'today' | '7d' | '30d';
export const GRAPH_TIME_WINDOWS: readonly GraphTimeWindow[] = ['all', 'today', '7d', '30d'];

export interface GraphFilterState {
  groups: GraphGroup[];
  /** Normalized tag (as `GET /tags` gives `norm`), or null. */
  tag: string | null;
  time: GraphTimeWindow;
}

export const NO_GRAPH_FILTER: GraphFilterState = { groups: [], tag: null, time: 'all' };
export const GRAPH_FILTER_STORAGE_KEY = 'graph-filter';

/** Calendar days a window covers, today included. */
const WINDOW_DAYS: Record<Exclude<GraphTimeWindow, 'all'>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
};

/** `?when=` → its window (only today, 7d, 30d), else null. */
export function parseWhenParam(value: string | null): GraphTimeWindow | null {
  return value === 'today' || value === '7d' || value === '30d' ? value : null;
}

export function isGraphFilterStateActive(state: GraphFilterState): boolean {
  return state.groups.length > 0 || state.tag !== null || state.time !== 'all';
}

/** A remembered value, checked field by field (anything odd falls back to "no filter"). */
export function parseStoredGraphFilter(raw: unknown): GraphFilterState {
  if (raw === null || typeof raw !== 'object') return NO_GRAPH_FILTER;
  const value = raw as Record<string, unknown>;
  const groups = Array.isArray(value.groups)
    ? GRAPH_GROUPS.filter((group) => (value.groups as unknown[]).includes(group))
    : [];
  const tag = typeof value.tag === 'string' && value.tag.trim() !== '' ? value.tag : null;
  const time = GRAPH_TIME_WINDOWS.find((window) => window === value.time) ?? 'all';
  return { groups, tag, time };
}

/** Local midnight that starts the window ending today (`today` = `YYYY-MM-DD`), or null. */
export function windowStart(time: GraphTimeWindow, today: string): number | null {
  if (time === 'all') return null;
  const first = isoAddDays(today, 1 - WINDOW_DAYS[time]);
  const [y, m, d] = first.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime();
}

export function toGraphFilter(state: GraphFilterState, today: string): GraphFilter {
  return {
    ...EMPTY_GRAPH_FILTER,
    groups: state.groups,
    tag: state.tag,
    since: windowStart(state.time, today),
  };
}

export interface GraphFilterMask {
  /** `match[i]` = 1 when `model.nodes[i]` matches. */
  match: Uint8Array;
  count: number;
}

/** Which nodes of `model` match; null when nothing is filtered. */
export function graphFilterMask(
  model: GraphModel | null,
  state: GraphFilterState,
  today: string,
): GraphFilterMask | null {
  if (!model || !isGraphFilterStateActive(state)) return null;
  const test = graphFilterPredicate(toGraphFilter(state, today));
  const match = new Uint8Array(model.nodes.length);
  let count = 0;
  for (const node of model.nodes) {
    if (!test(node)) continue;
    match[node.i] = 1;
    count += 1;
  }
  return { match, count };
}
