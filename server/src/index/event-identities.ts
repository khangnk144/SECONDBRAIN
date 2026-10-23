/**
 * Follows notes through the event log: each `note_created` starts an identity, `note_renamed`
 * carries it to the new path, `note_deleted` ends it. Activity attached to an event can then be
 * reported under the note's CURRENT path (or dropped when the note is gone), and a later note
 * with a deleted note's name is a different note.
 *
 * `trackedLog` is the shared, incremental form (review M3): the vault's one log reader keeps
 * appending to the same array while `events.jsonl` only grows, so the tracking is cached per
 * array and a later call applies only the events added since – one replay per log state, shared
 * by Today, the weekly review and every request. An event older than the last one applied (a
 * clock set back) cannot be appended in time order: the array is then tracked anew, which gives
 * exactly what `trackIdentities` gives. Items are in time order, so a day's events are found by
 * binary search (`itemsBetween`) instead of a walk over the whole log.
 */
import type { VaultPath } from '../vault/vault-types.js';
import type { IndexEvent } from './event-log.js';

export interface TrackedEvent {
  event: IndexEvent;
  /** The note the event belongs to (for links: the linking note). */
  id: number;
  /** Link events whose target was a known note at that moment. */
  targetId: number | null;
}

export interface TrackedLog {
  /** Events in time order (file order breaks ties; approximate history comes first anyway). */
  items: TrackedEvent[];
  /** Current path of every identity that still exists at the end of the log. */
  pathOf: ReadonlyMap<number, VaultPath>;
  /** The first `note_edited` that is not reconstructed history, or null. */
  firstExactEdit: TrackedEvent | null;
}

/** Events sorted by `ts` (ISO strings sort as text); stable for equal instants. */
export function chronological(events: readonly IndexEvent[]): IndexEvent[] {
  const valid = events.filter((e) => typeof e.ts === 'string');
  for (let i = 1; i < valid.length; i += 1) {
    if ((valid[i - 1] as IndexEvent).ts > (valid[i] as IndexEvent).ts) {
      return valid
        .map((event, index) => ({ event, index }))
        .sort((a, b) =>
          a.event.ts < b.event.ts ? -1 : a.event.ts > b.event.ts ? 1 : a.index - b.index,
        )
        .map(({ event }) => event);
    }
  }
  return valid;
}

interface Tracker extends TrackedLog {
  apply(event: IndexEvent): void;
  /** `ts` of the last event applied (the latest in time order). */
  lastTs: string | null;
}

function createTracker(): Tracker {
  const alive = new Map<VaultPath, number>();
  const pathOf = new Map<number, VaultPath>();
  let next = 0;
  const idFor = (path: VaultPath): number => {
    let id = alive.get(path);
    if (id === undefined) {
      id = next++;
      alive.set(path, id);
      pathOf.set(id, path);
    }
    return id;
  };
  const tracker: Tracker = {
    items: [],
    pathOf,
    firstExactEdit: null,
    lastTs: null,
    apply(event) {
      let id: number;
      let targetId: number | null = null;
      switch (event.event) {
        case 'note_renamed': {
          const from = event.oldPath;
          id = (from !== undefined ? alive.get(from) : undefined) ?? idFor(event.path);
          if (from !== undefined && alive.get(from) === id) alive.delete(from);
          // Renamed onto an existing note (an outside tool): that note is replaced.
          const replaced = alive.get(event.path);
          if (replaced !== undefined && replaced !== id) pathOf.delete(replaced);
          alive.set(event.path, id);
          pathOf.set(id, event.path);
          break;
        }
        case 'note_deleted':
          id = alive.get(event.path) ?? -1;
          alive.delete(event.path);
          pathOf.delete(id);
          break;
        case 'link_added':
        case 'link_removed':
          id = idFor(event.path);
          targetId = event.target !== undefined ? (alive.get(event.target) ?? null) : null;
          break;
        default:
          // note_created, note_edited and kinds a newer version may write.
          id = idFor(event.path);
      }
      const item = { event, id, targetId };
      tracker.items.push(item);
      tracker.lastTs = event.ts;
      if (tracker.firstExactEdit === null && event.event === 'note_edited' && !event.approx)
        tracker.firstExactEdit = item;
    },
  };
  return tracker;
}

function trackAll(events: readonly IndexEvent[]): Tracker {
  const tracker = createTracker();
  for (const event of chronological(events)) tracker.apply(event);
  return tracker;
}

/** A fresh tracking of `events` (tests and one-off callers). */
export function trackIdentities(events: readonly IndexEvent[]): TrackedLog {
  return trackAll(events);
}

interface CachedTracking {
  /** Events of the array consumed so far. */
  consumed: number;
  tracker: Tracker;
}

/** Keyed by the reader's array: an old array (another vault, a rewritten log) is garbage. */
const trackings = new WeakMap<readonly IndexEvent[], CachedTracking>();

/**
 * The tracking of `events`, brought up to date: the same object while the array only grows (its
 * items and paths follow the new events), a new one when the array shrank or an event came out of
 * time order.
 */
export function trackedLog(events: readonly IndexEvent[]): TrackedLog {
  let cached = trackings.get(events);
  if (!cached || cached.consumed > events.length) {
    cached = { consumed: events.length, tracker: trackAll(events) };
    trackings.set(events, cached);
    return cached.tracker;
  }
  for (; cached.consumed < events.length; cached.consumed += 1) {
    const event = events[cached.consumed] as IndexEvent;
    if (typeof event.ts !== 'string') continue;
    const { tracker } = cached;
    if (tracker.lastTs !== null && event.ts < tracker.lastTs) {
      cached.tracker = trackAll(events);
      cached.consumed = events.length;
      break;
    }
    tracker.apply(event);
  }
  return cached.tracker;
}

/** The items with `start <= ts < end` (ISO instants), found by binary search. */
export function itemsBetween(log: TrackedLog, start: string, end: string): TrackedEvent[] {
  const first = lowerBound(log.items, start);
  const last = lowerBound(log.items, end, first);
  return log.items.slice(first, last);
}

function lowerBound(items: readonly TrackedEvent[], ts: string, from = 0): number {
  let low = from;
  let high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if ((items[mid] as TrackedEvent).event.ts < ts) low = mid + 1;
    else high = mid;
  }
  return low;
}
