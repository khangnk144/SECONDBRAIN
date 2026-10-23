/**
 * The graph history's view of `state/events.jsonl`: the events of the vault's one shared, cached
 * reader (`index/event-log-reader.ts`, held by the activity service; it reads only the new tail
 * of a grown file, a rewritten file anew, and lets an unfinished last line wait) replayed into a
 * `LogState`. That reader keeps appending to the same array while the file only grows, so the
 * replay is cached by array: a request replays only the events added since the last one, and a
 * rewritten log (a new array) is replayed from the start. A replay is synchronous, so two
 * requests never apply the same tail twice.
 */
import type { IndexEvent } from '../index/event-log.js';
import { applyLogEvent, createLogState, type LogState } from './graph-history-state.js';

interface Replay {
  /** Events of the array applied so far. */
  applied: number;
  state: LogState;
}

/** Keyed by the reader's array: an old array (another vault, a rewritten log) is garbage. */
const replays = new WeakMap<readonly IndexEvent[], Replay>();

/** The log replayed up to its last event; the same state object while the log only grows. */
export function replayEventLog(events: readonly IndexEvent[]): LogState {
  let replay = replays.get(events);
  if (!replay || replay.applied > events.length) {
    replay = { applied: 0, state: createLogState() };
    replays.set(events, replay);
  }
  for (; replay.applied < events.length; replay.applied += 1) {
    const event = events[replay.applied];
    if (event) applyLogEvent(replay.state, event);
  }
  return replay.state;
}
