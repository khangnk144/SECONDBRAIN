/**
 * The answer of `GET /api/graph/history` (F24.1), kept per open vault while nothing it depends on
 * changed: the replayed log state (the shared replay of `graph-history-log.ts`, the same object
 * while the log only grows, so the number of lines it consumed tells a new line), the live graph
 * rows (compared field by field – far cheaper than building the history again) and the current
 * week. Built and serialized once, a second open of the brain map is a string copy instead of a
 * 0.7–1 s build and several MB of JSON (review A, graph note). An answer that used "now" for an
 * end (a note the log still holds alive is gone from the index, or the log has instants after
 * now) is never reused.
 */
import { startOfWeekMonday, toLocalDate } from '../lib/local-date.js';
import type { GraphRows } from '../index/view-row-queries.js';
import type { LogState } from './graph-history-state.js';

interface Cached {
  state: LogState;
  consumed: number;
  rows: GraphRows;
  week: string;
  json: string;
}

const answers = new WeakMap<object, Cached>();

function sameRows(a: GraphRows, b: GraphRows): boolean {
  if (a.notes.length !== b.notes.length || a.files.length !== b.files.length) return false;
  if (a.links.length !== b.links.length) return false;
  for (let i = 0; i < a.notes.length; i += 1) {
    const x = a.notes[i];
    const y = b.notes[i];
    if (x?.path !== y?.path || x?.title !== y?.title || x?.class !== y?.class) return false;
  }
  for (let i = 0; i < a.files.length; i += 1) if (a.files[i] !== b.files[i]) return false;
  for (let i = 0; i < a.links.length; i += 1) {
    if (a.links[i]?.from !== b.links[i]?.from || a.links[i]?.to !== b.links[i]?.to) return false;
  }
  return true;
}

/** Whether the build read the clock beyond the current week (see the file comment). */
function usesNow(state: LogState, rows: GraphRows, now: Date): boolean {
  if (state.firstTs !== null && state.firstTs > now.getTime()) return true;
  const live = new Set(rows.notes.map((note) => note.path));
  for (const path of state.alive.keys()) if (!live.has(path)) return true;
  return false;
}

/** The JSON of the history for `owner` (the vault's context), built by `build` when needed. */
export function cachedHistoryJson(
  owner: object,
  state: LogState,
  rows: GraphRows,
  now: Date,
  build: () => unknown,
): string {
  const consumed = state.applied + state.skipped;
  const week = startOfWeekMonday(toLocalDate(now));
  const known = answers.get(owner);
  if (
    known &&
    known.state === state &&
    known.consumed === consumed &&
    known.week === week &&
    sameRows(known.rows, rows)
  )
    return known.json;
  const json = JSON.stringify(build());
  if (usesNow(state, rows, now)) answers.delete(owner);
  else answers.set(owner, { state, consumed, rows, week, json });
  return json;
}
