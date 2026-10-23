/**
 * Replays `state/events.jsonl` (SPEC §4.15) into note identities for the graph time scrubber
 * (F24.1). A note keeps its identity across renames (`note_renamed`: `oldPath` → `path`), so its
 * history and its links follow it; a note re-created at the path where a deleted one last lived
 * (restore from the trash) continues that identity. Lines are applied in file order (the order
 * the indexer observed). Garbled lines, unknown events (`note_edited`, …) and lines without a
 * valid instant are skipped. Events about a note the log never saw created (an older log, a lost
 * line) make it known "since before the log began" (`-Infinity`, clamped later).
 */
import { parseLogLine, parseLogRecord, type ParsedLogLine } from './graph-history-line.js';

/** A still-open interval end. */
export const OPEN = Number.POSITIVE_INFINITY;
/** Before the log began. */
export const BEFORE_LOG = Number.NEGATIVE_INFINITY;

export interface PathSpan {
  path: string;
  from: number;
  to: number;
}

/** A link of a note to a target string: a resolved vault path, or the raw text of a ghost link. */
export interface LinkSpan {
  target: string;
  from: number;
  to: number;
}

export interface NoteIdentity {
  /** Where the note lived over time, in time order; the last one is open while it is alive. */
  spans: PathSpan[];
  links: LinkSpan[];
  /** First known from an `approx` line (or implicitly): its creation instant is an estimate. */
  approx: boolean;
}

export interface LogState {
  identities: NoteIdentity[];
  /** Alive identities by current path. */
  alive: Map<string, NoteIdentity>;
  /** Deleted identities by the path they last had (a re-creation there continues them). */
  dead: Map<string, NoteIdentity>;
  /** Earliest instant of any valid line, or null when nothing was read. */
  firstTs: number | null;
  /** Earliest instant of an exactly observed line (not `approx`), or null. */
  exactSince: number | null;
  applied: number;
  skipped: number;
}

const openLinks = new WeakMap<NoteIdentity, Map<string, LinkSpan>>();

export function createLogState(): LogState {
  return {
    identities: [],
    alive: new Map(),
    dead: new Map(),
    firstTs: null,
    exactSince: null,
    applied: 0,
    skipped: 0,
  };
}

function links(identity: NoteIdentity): Map<string, LinkSpan> {
  let map = openLinks.get(identity);
  if (!map) {
    map = new Map();
    openLinks.set(identity, map);
  }
  return map;
}

function startIdentity(state: LogState, path: string, from: number, approx: boolean) {
  const identity: NoteIdentity = { spans: [{ path, from, to: OPEN }], links: [], approx };
  state.identities.push(identity);
  state.alive.set(path, identity);
  return identity;
}

/** The identity alive at `path`, or one known since before the log began. */
function aliveAt(state: LogState, path: string): NoteIdentity {
  return state.alive.get(path) ?? startIdentity(state, path, BEFORE_LOG, true);
}

function endSpan(identity: NoteIdentity, ts: number): void {
  const last = identity.spans[identity.spans.length - 1];
  if (last && last.to === OPEN) last.to = Math.max(last.from, ts);
}

/** Deletion: the note and every link it held end at `ts`. */
function bury(state: LogState, identity: NoteIdentity, path: string, ts: number): void {
  endSpan(identity, ts);
  for (const span of links(identity).values()) span.to = Math.max(span.from, ts);
  links(identity).clear();
  if (state.alive.get(path) === identity) state.alive.delete(path);
  state.dead.set(path, identity);
}

function apply(state: LogState, e: ParsedLogLine): boolean {
  switch (e.event) {
    case 'note_created': {
      if (state.alive.has(e.path)) return true;
      const revived = state.dead.get(e.path);
      if (!revived) {
        startIdentity(state, e.path, e.ts, e.approx);
        return true;
      }
      state.dead.delete(e.path);
      revived.spans.push({ path: e.path, from: e.ts, to: OPEN });
      state.alive.set(e.path, revived);
      return true;
    }
    case 'note_deleted':
      bury(state, aliveAt(state, e.path), e.path, e.ts);
      return true;
    case 'note_renamed': {
      if (!e.oldPath || e.oldPath === e.path) return false;
      const identity = aliveAt(state, e.oldPath);
      const replaced = state.alive.get(e.path);
      // A rename onto an existing file replaces it (the indexer reports no separate delete).
      if (replaced && replaced !== identity) bury(state, replaced, e.path, e.ts);
      endSpan(identity, e.ts);
      identity.spans.push({ path: e.path, from: e.ts, to: OPEN });
      state.alive.delete(e.oldPath);
      state.alive.set(e.path, identity);
      state.dead.delete(e.path);
      return true;
    }
    case 'link_added':
    case 'link_removed': {
      if (!e.target) return false;
      const identity = aliveAt(state, e.path);
      const open = links(identity);
      const current = open.get(e.target);
      if (e.event === 'link_added') {
        if (current) return true;
        const span = { target: e.target, from: e.ts, to: OPEN };
        identity.links.push(span);
        open.set(e.target, span);
      } else if (current) {
        current.to = Math.max(current.from, e.ts);
        open.delete(e.target);
      } else {
        // Removed but never seen added: it existed before the log began.
        identity.links.push({ target: e.target, from: BEFORE_LOG, to: e.ts });
      }
      return true;
    }
    default:
      return false;
  }
}

/** Applies one line of the log (without its newline); returns whether it was used. */
export function applyLogLine(state: LogState, line: string): boolean {
  if (line.trim() === '') return false;
  return applyParsed(state, parseLogLine(line));
}

/** Applies one event as the shared log reader parsed it (`index/event-log-reader.ts`). */
export function applyLogEvent(state: LogState, event: object): boolean {
  return applyParsed(state, parseLogRecord(event));
}

function applyParsed(state: LogState, parsed: ParsedLogLine | null): boolean {
  if (!parsed || !apply(state, parsed)) {
    state.skipped += 1;
    return false;
  }
  state.applied += 1;
  state.firstTs = state.firstTs === null ? parsed.ts : Math.min(state.firstTs, parsed.ts);
  if (!parsed.approx) {
    state.exactSince =
      state.exactSince === null ? parsed.ts : Math.min(state.exactSince, parsed.ts);
  }
  return true;
}

/** Whether `identity` still holds an open link to `target`. */
export function hasOpenLink(identity: NoteIdentity, target: string): boolean {
  return links(identity).has(target);
}

/**
 * Creation instant of each note alive now, by path, when the log saw it created exactly (not an
 * `approx` estimate); a renamed note keeps the instant of its creation.
 */
export function exactCreationTimes(state: LogState): Map<string, number> {
  const out = new Map<string, number>();
  for (const [path, identity] of state.alive) {
    const first = identity.spans[0]?.from;
    if (!identity.approx && first !== undefined && Number.isFinite(first)) out.set(path, first);
  }
  return out;
}
