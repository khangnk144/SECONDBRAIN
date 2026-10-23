/**
 * The unfiltered body of `GET /api/graph` (F16, F24.2–F24.3) kept per open vault while nothing it
 * reads changed: the index (its change stamp moves with every change task and every rebuild
 * swap) and the event log (the shared reader's array, the same object while the file only grows,
 * and its length). Building it reads every note, link and tag of the index (about 140 ms on the
 * 5k vault, more on a busy machine: review A measured p95 368 ms against the 300 ms budget of
 * MILESTONE-3); a repeated open of the map, or a filter change, reuses it. The JSON text is kept
 * too, made on the first unfiltered request. Without a change stamp (test doubles) nothing is
 * kept.
 */
import type { IndexEvent } from '../index/event-log.js';
import type { IndexService } from '../index/index-types.js';
import type { GraphResponseBody } from './graph-node-facts.js';

interface Cached {
  stamp: string;
  events: readonly IndexEvent[];
  eventCount: number;
  body: GraphResponseBody;
  json: string | null;
}

const bodies = new WeakMap<object, Cached>();

export interface GraphBody {
  body: GraphResponseBody;
  /** The body as JSON text (built once per kept body). */
  json(): string;
}

export function cachedGraphBody(
  index: Pick<IndexService, 'changeStamp'>,
  events: readonly IndexEvent[],
  build: () => GraphResponseBody,
): GraphBody {
  const stamp = index.changeStamp?.();
  if (stamp === undefined) {
    const body = build();
    return { body, json: () => JSON.stringify(body) };
  }
  let entry = bodies.get(index);
  if (
    !entry ||
    entry.stamp !== stamp ||
    entry.events !== events ||
    entry.eventCount !== events.length
  ) {
    entry = { stamp, events, eventCount: events.length, body: build(), json: null };
    bodies.set(index, entry);
  }
  const kept = entry;
  return { body: kept.body, json: () => (kept.json ??= JSON.stringify(kept.body)) };
}
