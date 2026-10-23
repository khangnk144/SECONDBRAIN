// `GET /api/graph` keeps its built body while the index and the event log stay the same
// (FIX-B item 5: p95 368 ms under load against the 300 ms budget of MILESTONE-3).
import { describe, expect, it } from 'vitest';
import { cachedGraphBody } from '../../src/graph/graph-response-cache.js';
import type { GraphResponseBody } from '../../src/graph/graph-node-facts.js';
import type { IndexEvent } from '../../src/index/event-log.js';
import { SerialQueue } from '../../src/index/serial-queue.js';

const ts = (h: number) => new Date(2026, 9, 22, h, 0).toISOString();
const A = '2 Areas/Giải tích 1.md';

describe('graph body cache', () => {
  it('builds once per index stamp and log length; a new stamp, line or log rebuilds', () => {
    let stamp = '1:0';
    const index = { changeStamp: () => stamp };
    let events: IndexEvent[] = [{ ts: ts(8), event: 'note_created', path: A }];
    let builds = 0;
    const build = (): GraphResponseBody => ({ nodes: [], edges: [], matches: [String(++builds)] });
    const body = () => cachedGraphBody(index, events, build);
    expect(body().body.matches).toEqual(['1']);
    expect(body().json()).toBe('{"nodes":[],"edges":[],"matches":["1"]}');
    expect(body().body.matches).toEqual(['1']);
    stamp = '1:2'; // a change task ran
    expect(body().body.matches).toEqual(['2']);
    events.push({ ts: ts(9), event: 'note_edited', path: A });
    expect(body().body.matches).toEqual(['3']);
    events = [...events]; // the log was rewritten: a new array
    expect(body().body.matches).toEqual(['4']);
    stamp = '2:2'; // a rebuild swapped the database
    expect(body().json()).toBe('{"nodes":[],"edges":[],"matches":["5"]}');
  });

  it('keeps nothing for an index without a change stamp (test doubles)', () => {
    let builds = 0;
    const build = (): GraphResponseBody => ({ nodes: [], edges: [], matches: [String(++builds)] });
    cachedGraphBody({}, [], build);
    expect(cachedGraphBody({}, [], build).body.matches).toEqual(['2']);
  });

  it('the change queue counts task boundaries, also for a failed task', async () => {
    const queue = new SerialQueue();
    expect(queue.generation).toBe(0);
    let during = -1;
    await queue.enqueue(async () => {
      during = queue.generation;
    });
    expect(during).toBe(1);
    expect(queue.generation).toBe(2);
    await expect(queue.enqueue(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(queue.generation).toBe(4);
  });
});
