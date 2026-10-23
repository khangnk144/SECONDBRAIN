// A second open of the brain map reuses the built history while nothing it depends on changed
// (review A, graph note; F24.1).
import { describe, expect, it } from 'vitest';
import { cachedHistoryJson } from '../../src/graph/graph-history-cache.js';
import { replayEventLog } from '../../src/graph/graph-history-log.js';
import type { IndexEvent } from '../../src/index/event-log.js';
import type { GraphRows } from '../../src/index/view-row-queries.js';

const NOW = new Date(2026, 9, 22, 12, 0);
const ts = (h: number) => new Date(2026, 9, 22, h, 0).toISOString();
const A = '2 Areas/Giải tích 1.md';
const B = '1 Projects/Đồ án Giải tích.md';

const rows = (): GraphRows => ({
  notes: [
    { path: A, title: 'Giải tích 1', class: 'user' },
    { path: B, title: 'Đồ án Giải tích', class: 'user' },
  ],
  files: [],
  links: [{ from: B, to: A }],
});

describe('the graph history answer is kept while nothing changed (F24.1)', () => {
  it('builds once for the same log, rows and week; again after a new line, a row change or a new week', () => {
    const events: IndexEvent[] = [
      { ts: ts(8), event: 'note_created', path: A },
      { ts: ts(9), event: 'note_created', path: B },
    ];
    const owner = {};
    let builds = 0;
    const build = () => ({ builds: ++builds });
    const answer = () => cachedHistoryJson(owner, replayEventLog(events), rows(), NOW, build);
    expect(answer()).toBe('{"builds":1}');
    expect(answer()).toBe('{"builds":1}');
    events.push({ ts: ts(10), event: 'link_added', path: B, target: A });
    expect(answer()).toBe('{"builds":2}');
    const renamed = rows();
    renamed.notes[0] = { path: A, title: 'Giải tích I', class: 'user' };
    expect(cachedHistoryJson(owner, replayEventLog(events), renamed, NOW, build)).toBe(
      '{"builds":3}',
    );
    const nextWeek = new Date(NOW.getTime() + 7 * 86_400_000);
    expect(cachedHistoryJson(owner, replayEventLog(events), renamed, nextWeek, build)).toBe(
      '{"builds":4}',
    );
    expect(cachedHistoryJson({}, replayEventLog(events), renamed, nextWeek, build)).toBe(
      '{"builds":5}',
    ); // another vault
  });

  it('an answer that ended a gone note "now" is never reused', () => {
    const events: IndexEvent[] = [{ ts: ts(8), event: 'note_created', path: '0 Inbox/Đã xoá.md' }];
    const owner = {};
    let builds = 0;
    const build = () => ++builds;
    cachedHistoryJson(owner, replayEventLog(events), rows(), NOW, build);
    cachedHistoryJson(owner, replayEventLog(events), rows(), NOW, build);
    expect(builds).toBe(2);
  });
});
