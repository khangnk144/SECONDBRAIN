import { describe, expect, it } from 'vitest';
import {
  buildGraphHistory,
  type GraphHistory,
  type LiveGraphInput,
} from '../../src/graph/graph-history.js';
import {
  applyLogLine,
  createLogState,
  exactCreationTimes,
} from '../../src/graph/graph-history-state.js';
import { buildGraph } from '../../src/graph/vault-graph.js';
import type { GraphRows } from '../../src/index/view-row-queries.js';
import {
  at,
  COURSE,
  DAILY,
  edgeKey,
  EXPECTED_WEEKS,
  FIXTURE_LOG,
  IDEA,
  LIVE_ROWS,
  NOW,
  PDF,
  PROJECT,
  TEMPLATE,
  WEEKS,
} from './graph-history-fixture.js';

function liveInput(rows: GraphRows): LiveGraphInput {
  return {
    graph: buildGraph(rows),
    links: rows.links,
    notes: new Set(rows.notes.map((n) => n.path)),
    files: new Set(rows.files),
  };
}

function replay(lines: readonly string[]) {
  const state = createLogState();
  for (const line of lines) applyLogLine(state, line);
  return state;
}

/** What existed at `instant` (the scrubber's rule: from ≤ … < to). */
function existingAt(history: GraphHistory, instant: number) {
  const nodes = new Set(
    history.nodes
      .filter((n) => n.firstSeen < instant && (n.removedAt === undefined || n.removedAt >= instant))
      .map((n) => n.id),
  );
  const edges = history.edges
    .filter((e) => e.addedAt < instant && (e.removedAt === undefined || e.removedAt >= instant))
    .map((e) => edgeKey(e.from, e.to));
  return { nodes: [...nodes].sort(), edges: [...new Set(edges)].sort() };
}

const weekEnd = (monday: string) => {
  const [y, m, d] = monday.split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, (d ?? 1) + 7).getTime();
};

describe('graph history from the event log (F24.1)', () => {
  const state = replay(FIXTURE_LOG);
  const history = buildGraphHistory(state, liveInput(LIVE_ROWS), NOW);

  it('(F24.1) shows exactly the nodes and edges that existed at the end of each of 6 weeks', () => {
    expect(history.firstWeek).toBe(WEEKS[0]);
    expect(history.currentWeek).toBe(WEEKS[5]);
    WEEKS.forEach((monday, w) => {
      expect(existingAt(history, weekEnd(monday)), `week of ${monday}`).toEqual(EXPECTED_WEEKS[w]);
    });
  });

  it('(F24.1) the current week equals the live graph', () => {
    const live = buildGraph(LIVE_ROWS);
    const now = existingAt(history, NOW.getTime() + 1);
    expect(now.nodes).toEqual(live.nodes.map((n) => n.id).sort());
    expect(now.edges).toEqual(live.edges.map((e) => edgeKey(e.source, e.target)).sort());
  });

  it('(F24.1) a renamed note keeps its identity, history and links under its current path', () => {
    const idea = history.nodes.filter((n) => n.id === IDEA);
    expect(idea).toEqual([{ id: IDEA, kind: 'note', firstSeen: Date.parse(at('2026-09-15')) }]);
    expect(history.nodes.some((n) => n.id === '0 Inbox/Ý tưởng.md')).toBe(false);
  });

  it('(F24.1) a deleted note that came back has two lifetimes; links end with their note', () => {
    expect(history.nodes.filter((n) => n.id === DAILY)).toEqual([
      {
        id: DAILY,
        kind: 'note',
        firstSeen: Date.parse(at('2026-10-06 07:00')),
        removedAt: Date.parse(at('2026-10-13 12:00')),
      },
      { id: DAILY, kind: 'note', firstSeen: Date.parse(at('2026-10-20 09:00')) },
    ]);
    const [from, to] = [DAILY, PROJECT].sort();
    expect(history.edges.filter((e) => e.from === from && e.to === to)).toEqual([
      {
        from,
        to,
        addedAt: Date.parse(at('2026-10-06 07:00')),
        removedAt: Date.parse(at('2026-10-13 12:00')),
      },
      { from, to, addedAt: Date.parse(at('2026-10-20 09:00')) },
    ]);
  });

  it('(F24.1) a PDF is a source node only while a drawn note links to it', () => {
    // No note links it now, so it is not on the live map: it carries its own title and group.
    expect(history.nodes.filter((n) => n.id === PDF)).toEqual([
      {
        id: PDF,
        kind: 'source',
        firstSeen: Date.parse(at('2026-09-30 08:00')),
        removedAt: Date.parse(at('2026-10-15 12:00')),
        title: 'bài giảng 1.pdf',
        group: 'resources',
        class: 'source',
      },
    ]);
  });

  it('(F24.1) templates, ghost links and garbled or unknown lines leave no trace', () => {
    const ids = new Set(history.nodes.map((n) => n.id));
    expect(ids.has(TEMPLATE)).toBe(false);
    expect(ids.has('Ghost')).toBe(false);
    expect(ids.has('0 Inbox/Không có giờ.md')).toBe(false);
    expect(ids.has('0 Inbox/Giờ sai.md')).toBe(false);
    expect(history.edges.some((e) => e.from === TEMPLATE || e.to === TEMPLATE)).toBe(false);
    // The truncated line, note_edited, the line without ts and the bad ts (blank lines are not counted).
    expect(state.skipped).toBe(4);
    expect(state.applied).toBe(FIXTURE_LOG.length - 5);
  });

  it('(F24.1) nodes not on the live map carry what the client needs to draw them', () => {
    const rows: GraphRows = {
      ...LIVE_ROWS,
      notes: LIVE_ROWS.notes.filter((n) => n.path !== DAILY),
    };
    const gone = buildGraphHistory(replay(FIXTURE_LOG.slice(0, -2)), liveInput(rows), NOW);
    expect(gone.nodes.find((n) => n.id === DAILY)).toMatchObject({
      title: '2026-10-06',
      group: 'daily',
      class: 'user',
    });
    expect(gone.nodes.find((n) => n.id === COURSE)).not.toHaveProperty('title');
  });

  it('(F24.1) approx history and exact history: exactSince, creation times only when exact', () => {
    expect(history.exactSince).toBe(Date.parse(at('2026-09-22 10:00')));
    const created = exactCreationTimes(state);
    expect(created.get(PROJECT)).toBe(Date.parse(at('2026-09-22 10:00')));
    expect(created.has(COURSE)).toBe(false);
    expect(created.has(IDEA)).toBe(false);
  });

  it('(F24.1) a note the log never saw is absent from the past; one the index lost ends now', () => {
    const rows: GraphRows = {
      notes: [
        ...LIVE_ROWS.notes.filter((n) => n.path !== PROJECT),
        { path: '0 Inbox/Mới.md', title: 'Mới', class: 'user' },
      ],
      files: LIVE_ROWS.files,
      links: LIVE_ROWS.links.filter((l) => l.from !== PROJECT && l.to !== PROJECT),
    };
    const result = buildGraphHistory(state, liveInput(rows), NOW);
    expect(result.nodes.some((n) => n.id === '0 Inbox/Mới.md')).toBe(false);
    expect(
      result.nodes.find((n) => n.id === PROJECT && n.removedAt === NOW.getTime()),
    ).toBeTruthy();
  });

  it('(F24.1) an empty log has no first week', () => {
    const result = buildGraphHistory(createLogState(), liveInput(LIVE_ROWS), NOW);
    expect(result).toMatchObject({ firstWeek: null, currentWeek: WEEKS[5], nodes: [], edges: [] });
  });

  it('(F24.1) a rename onto an existing note replaces it; events for unknown notes start the log', () => {
    const lines = [
      JSON.stringify({ ts: at('2026-10-01'), event: 'note_created', path: '0 Inbox/A.md' }),
      JSON.stringify({ ts: at('2026-10-02'), event: 'note_created', path: '0 Inbox/B.md' }),
      JSON.stringify({
        ts: at('2026-10-03'),
        event: 'note_renamed',
        path: '0 Inbox/B.md',
        oldPath: '0 Inbox/A.md',
      }),
      JSON.stringify({
        ts: at('2026-10-04'),
        event: 'link_added',
        path: '0 Inbox/C.md',
        target: '0 Inbox/B.md',
      }),
    ];
    const rows: GraphRows = {
      notes: [
        { path: '0 Inbox/B.md', title: 'B', class: 'user' },
        { path: '0 Inbox/C.md', title: 'C', class: 'user' },
      ],
      files: [],
      links: [{ from: '0 Inbox/C.md', to: '0 Inbox/B.md' }],
    };
    const result = buildGraphHistory(replay(lines), liveInput(rows), NOW);
    const b = result.nodes.filter((n) => n.id === '0 Inbox/B.md');
    // The renamed A (since 10-01) and the replaced B (10-02 → 10-03) both end under B's path.
    expect(b.map((n) => [n.firstSeen, n.removedAt])).toEqual([
      [Date.parse(at('2026-10-01')), undefined],
    ]);
    expect(result.nodes.find((n) => n.id === '0 Inbox/C.md')?.firstSeen).toBe(
      Date.parse(at('2026-10-01')),
    );
  });
});
