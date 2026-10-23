import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActivityNoteRow } from '../../src/index/activity-rows.js';
import type { AddedLink } from '../../src/index/activity-service.js';
import { aiTouchedPagesOn } from '../../src/index/ai-touched-pages.js';
import type { IndexEvent } from '../../src/index/event-log.js';
import type { OutlinkRef } from '../../src/index/index-types.js';
import { notesCreatedOn } from '../../src/index/today-activity.js';
import { buildTodayBrain, MAX_BRAIN_NODES } from '../../src/index/today-brain.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';

const DAY = '2026-03-02';
const at = (h: number, m = 0, day = 2) => new Date(2026, 2, day, h, m).toISOString();
const note = (p: string, title = path.posix.basename(p, '.md')): ActivityNoteRow => ({
  path: p,
  title,
  class: 'user',
  mtimeMs: new Date(2025, 0, 1).getTime(),
});

/** An index double answering outlinks/linkingNotes from a list of resolved links. */
function linkIndex(links: [string, string][], extra: OutlinkRef[] = []) {
  return {
    outlinks: (p: string): OutlinkRef[] => [
      ...links
        .filter(([from]) => from === p)
        .map(([, to], line) => ({
          raw: `[[${to}]]`,
          target: to,
          line,
          toPath: to,
          ambiguous: false,
        })),
      ...extra.filter((ref) => ref.raw.startsWith(p)),
    ],
    linkingNotes: (p: string) => [...new Set(links.filter(([, to]) => to === p).map(([f]) => f))],
  };
}

describe('notesCreatedOn (F24.4 "ghi chú mới")', () => {
  it('counts notes created that local day under their current path; deleted and excluded notes drop', () => {
    const events: IndexEvent[] = [
      { ts: at(23, 59, 1), event: 'note_created', path: '0 Inbox/Hôm qua.md' },
      { ts: at(0, 0), event: 'note_created', path: '0 Inbox/Ý tưởng.md' },
      {
        ts: at(9),
        event: 'note_renamed',
        path: '2 Areas/Ý tưởng hay.md',
        oldPath: '0 Inbox/Ý tưởng.md',
      },
      { ts: at(10), event: 'note_created', path: '0 Inbox/Xoá.md' },
      { ts: at(11), event: 'note_deleted', path: '0 Inbox/Xoá.md' },
      { ts: at(12), event: 'note_created', path: 'Templates/Mẫu.md' },
      { ts: at(13), event: 'note_edited', path: '0 Inbox/Hôm qua.md' },
      { ts: at(0, 0, 3), event: 'note_created', path: '0 Inbox/Ngày mai.md' },
    ];
    const notes = ['0 Inbox/Hôm qua.md', '2 Areas/Ý tưởng hay.md', '0 Inbox/Ngày mai.md'].map((p) =>
      note(p),
    );
    expect([...notesCreatedOn(events, notes, DAY)]).toEqual(['2 Areas/Ý tưởng hay.md']);
    expect([...notesCreatedOn(events, notes, '2026-03-01')]).toEqual(['0 Inbox/Hôm qua.md']);
  });
});

describe('buildTodayBrain (F24.4)', () => {
  it('(F24.4) keeps at most 24 nodes, most connected first, with the links among them only', () => {
    const touched = Array.from(
      { length: 30 },
      (_, i) => `2 Areas/Ghi chú ${String(i).padStart(2, '0')}.md`,
    );
    const hub = '1 Projects/Đồ án Giải tích.md';
    // Notes 0–9 link to the hub; 0 and 1 link each other; 29 links to 28.
    const links: [string, string][] = [
      ...touched.slice(0, 10).map((p): [string, string] => [p, hub]),
      [touched[0]!, touched[1]!],
      [touched[1]!, touched[0]!],
      [touched[29]!, touched[28]!],
    ];
    const added: AddedLink[] = [
      { from: touched[0]!, to: hub, resolved: true },
      { from: touched[0]!, to: 'Chưa có', resolved: false },
    ];
    const brain = buildTodayBrain({
      notes: [...touched, hub].map((p) => note(p)),
      created: new Set(touched.slice(0, 2)),
      touched: new Set(touched),
      links: added,
      aiPages: ['wiki/Khái niệm.md'], // not a note now: counted, not drawn
      index: linkIndex(links),
    });
    expect(brain).toMatchObject({ notesNew: 2, notesTouched: 30, linksAdded: 2, aiTouched: 1 });
    expect(brain.nodes).toHaveLength(MAX_BRAIN_NODES);
    expect(brain.nodes[0]).toEqual({ path: hub, title: 'Đồ án Giải tích', group: 'projects' });
    expect(brain.nodes.slice(1, 3).map((n) => n.path)).toEqual([touched[0], touched[1]]);
    expect(brain.nodes.map((n) => n.path)).not.toContain('Chưa có');
    const shown = new Set(brain.nodes.map((n) => n.path));
    for (const edge of brain.edges) {
      expect(shown.has(edge.from) && shown.has(edge.to)).toBe(true);
    }
    // The mutual pair is one edge, from the smaller path.
    expect(
      brain.edges.filter(
        (e) => [e.from, e.to].sort().join() === [touched[0], touched[1]].sort().join(),
      ),
    ).toEqual([{ from: touched[0], to: touched[1] }]);
    expect(brain.edges.filter((e) => e.to === hub)).toHaveLength(10);
  });

  it('draws the targets of new links and the AI pages that exist; ambiguous links add nothing', () => {
    const ai = 'wiki/Ma trận.md';
    const brain = buildTodayBrain({
      notes: [note('Daily/2026-03-02.md'), note('3 Resources/Bài báo.md'), note(ai)],
      created: new Set(),
      touched: new Set(['Daily/2026-03-02.md']),
      links: [{ from: 'Daily/2026-03-02.md', to: '3 Resources/Bài báo.md', resolved: true }],
      aiPages: [ai, ai],
      index: linkIndex(
        [['Daily/2026-03-02.md', '3 Resources/Bài báo.md']],
        [
          {
            raw: 'wiki/Ma trận.md',
            target: 'Mơ hồ',
            line: 1,
            toPath: 'Daily/2026-03-02.md',
            ambiguous: true,
          },
        ],
      ),
    });
    expect(brain.aiTouched).toBe(1);
    expect(brain.nodes.map((n) => [n.path, n.group])).toEqual([
      ['Daily/2026-03-02.md', 'daily'],
      ['3 Resources/Bài báo.md', 'resources'],
      [ai, 'wiki'],
    ]);
    expect(brain.edges).toEqual([{ from: 'Daily/2026-03-02.md', to: '3 Resources/Bài báo.md' }]);
  });

  it('is empty on a quiet day', () => {
    expect(
      buildTodayBrain({
        notes: [note('2 Areas/A.md')],
        created: new Set(),
        touched: new Set(),
        links: [],
        aiPages: [],
        index: linkIndex([]),
      }),
    ).toEqual({ notesNew: 0, notesTouched: 0, linksAdded: 0, aiTouched: 0, nodes: [], edges: [] });
  });
});

describe('aiTouchedPagesOn (F34 count for "Não hôm nay")', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) removeDir(dir);
    dir = null;
  });

  const run = (status: string, finishedAt: string | null, outputs: string[]) => ({
    runId: 'x',
    contentHash: 'h',
    startedAt: at(8),
    finishedAt,
    status,
    outputs,
    logLine: null,
    reason: null,
  });
  const manifest = (ingest: string, id: string, runs: unknown[]) =>
    writeFileSync(
      path.join(ingest, `${id}.json`),
      JSON.stringify({ version: 1, sourceId: id, path: `3 Resources/papers/${id}.pdf`, runs }),
    );

  it('(F24.4) lists the unique outputs of runs that succeeded that local day', async () => {
    dir = makeTempDir('sb ingest Đồ án');
    const ingest = path.join(dir, 'state', 'ingest');
    expect(await aiTouchedPagesOn(ingest, DAY)).toEqual([]); // no folder yet
    mkdirSync(ingest, { recursive: true });
    manifest(ingest, 'bai-bao-a', [
      run('succeeded', at(23, 59, 1), ['wiki/Hôm qua.md']),
      run('succeeded', at(0, 0), ['wiki/Ma trận.md', 'wiki/Khái niệm.md']),
      run('failed', at(9), ['wiki/Hỏng.md']),
      run('running', null, ['wiki/Đang chạy.md']),
    ]);
    manifest(ingest, 'bai-bao-b', [run('succeeded', at(10), ['wiki/Ma trận.md'])]);
    writeFileSync(path.join(ingest, 'hong.json'), '{ not json');
    writeFileSync(path.join(ingest, 'ghi-chu.txt'), 'ignored');
    expect(await aiTouchedPagesOn(ingest, DAY)).toEqual(['wiki/Khái niệm.md', 'wiki/Ma trận.md']);
    expect(await aiTouchedPagesOn(ingest, '2026-03-01')).toEqual(['wiki/Hôm qua.md']);

    // A manifest rewritten later (another run) is read again.
    manifest(ingest, 'bai-bao-b', [
      run('succeeded', at(10), ['wiki/Ma trận.md']),
      run('succeeded', at(15), ['wiki/Đạo hàm riêng phần.md']),
    ]);
    expect(await aiTouchedPagesOn(ingest, DAY)).toEqual([
      'wiki/Khái niệm.md',
      'wiki/Ma trận.md',
      'wiki/Đạo hàm riêng phần.md',
    ]);
  });
});
