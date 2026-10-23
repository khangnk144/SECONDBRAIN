// The shared, incremental identity replay of events.jsonl (review M3): one replay per log state,
// a later request applies only the new lines, and the result is exactly a fresh replay's.
import { describe, expect, it } from 'vitest';
import { computeTouchedByDay } from '../../src/index/activity-service.js';
import type { ActivityNoteRow } from '../../src/index/activity-rows.js';
import type { IndexEvent } from '../../src/index/event-log.js';
import {
  itemsBetween,
  trackedLog,
  trackIdentities,
  type TrackedLog,
} from '../../src/index/event-identities.js';

const DAY = 86_400_000;
const start = new Date(2026, 0, 1, 8, 0).getTime();
const at = (i: number) => new Date(start + i * 60_000).toISOString();

/** A synthetic year: creations, edits, renames, deletes and links among 50 notes. */
function syntheticLog(count: number, from = 0): IndexEvent[] {
  const out: IndexEvent[] = [];
  for (let i = from; i < from + count; i += 1) {
    const n = i % 50;
    const path = `2 Areas/Môn ${n}.md`;
    const kind = i % 7;
    if (kind === 0) out.push({ ts: at(i), event: 'note_created', path });
    else if (kind === 1) out.push({ ts: at(i), event: 'note_edited', path });
    else if (kind === 2)
      out.push({ ts: at(i), event: 'link_added', path, target: `2 Areas/Môn ${(n + 1) % 50}.md` });
    else if (kind === 3)
      out.push({ ts: at(i), event: 'note_renamed', path: `1 Projects/Môn ${n}.md`, oldPath: path });
    else if (kind === 4)
      out.push({ ts: at(i), event: 'note_renamed', path, oldPath: `1 Projects/Môn ${n}.md` });
    else if (kind === 5)
      out.push({ ts: at(i), event: 'note_deleted', path: `2 Areas/Môn ${(n + 3) % 50}.md` });
    else
      out.push({
        ts: at(i),
        event: 'link_removed',
        path,
        target: `2 Areas/Môn ${(n + 1) % 50}.md`,
      });
  }
  return out;
}

/** What a log says, independent of object identity. */
const view = (log: TrackedLog) => ({
  items: log.items.map(({ event, id, targetId }) => [
    event.ts,
    event.event,
    event.path,
    id,
    targetId,
  ]),
  pathOf: [...log.pathOf].sort((a, b) => a[0] - b[0]),
  firstExactEdit: log.firstExactEdit?.event.ts ?? null,
});

/** An array that counts how many of its elements were read. */
function counting(events: IndexEvent[]) {
  const reads = { count: 0 };
  const proxy = new Proxy(events, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.count += 1;
      return Reflect.get(target, key, receiver);
    },
  });
  return { proxy, reads };
}

describe('the shared identity replay (review M3)', () => {
  it('grows with the log: the same object, only new lines applied, equal to a fresh replay', () => {
    const events = syntheticLog(2_000);
    const { proxy, reads } = counting(events);
    const first = trackedLog(proxy);
    expect(view(first)).toEqual(view(trackIdentities(events)));
    reads.count = 0;
    expect(trackedLog(proxy)).toBe(first);
    expect(reads.count).toBe(0); // unchanged log: nothing read again
    events.push(...syntheticLog(30, 2_000));
    const grown = trackedLog(proxy);
    expect(grown).toBe(first);
    expect(reads.count).toBe(30);
    expect(view(grown)).toEqual(view(trackIdentities(events)));
  });

  it('a line out of time order (clock set back) or a shorter array is replayed anew, exactly', () => {
    const events = syntheticLog(500);
    const before = trackedLog(events);
    events.push({ ts: at(10), event: 'note_edited', path: '2 Areas/Môn 3.md' });
    events.push({ ts: at(600), event: 'note_created', path: '0 Inbox/Mới.md' });
    const after = trackedLog(events);
    expect(after).not.toBe(before);
    expect(view(after)).toEqual(view(trackIdentities(events)));
    events.splice(100);
    expect(view(trackedLog(events))).toEqual(view(trackIdentities(events)));
  });

  it('finds a window by binary search, ends excluded', () => {
    const log = trackedLog(syntheticLog(100));
    const window = itemsBetween(log, at(10), at(20));
    expect(window.map((item) => item.event.ts)).toEqual(
      Array.from({ length: 10 }, (_, i) => at(10 + i)),
    );
    expect(itemsBetween(log, at(200), at(300))).toEqual([]);
  });

  it('(F35.9) a week of a 150k-line log after one more save reads that line, not the whole log', () => {
    const events = syntheticLog(150_000);
    const { proxy, reads } = counting(events);
    const notes: ActivityNoteRow[] = Array.from({ length: 50 }, (_, n) => ({
      path: `2 Areas/Môn ${n}.md`,
      title: `Môn ${n}`,
      class: 'user',
      mtimeMs: start,
    }));
    const lastDay = new Date(start + 150_000 * 60_000);
    const day = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const to = day(lastDay);
    const from = day(new Date(lastDay.getTime() - 6 * DAY));
    const before = computeTouchedByDay(proxy, notes, from, to);
    events.push({ ts: at(150_000), event: 'note_edited', path: '2 Areas/Môn 7.md' });
    reads.count = 0;
    const after = computeTouchedByDay(proxy, notes, from, to);
    expect(reads.count).toBe(1);
    expect(after.get(to)?.has('2 Areas/Môn 7.md')).toBe(true);
    expect([...before.keys()]).toEqual([...after.keys()]);
    // Same answer as a replay from scratch of the same lines.
    expect(computeTouchedByDay([...events], notes, from, to)).toEqual(after);
  });
});
