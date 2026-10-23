import { describe, expect, it } from 'vitest';
import { buildGraphHistory } from '../../../../server/src/graph/graph-history';
import { applyLogLine, createLogState } from '../../../../server/src/graph/graph-history-state';
import { buildGraph } from '../../../../server/src/graph/vault-graph';
import {
  DAILY,
  edgeKey,
  EXPECTED_WEEKS,
  FIXTURE_LOG,
  LIVE_ROWS,
  NOW,
  PDF,
  PROJECT,
  WEEKS,
} from '../../../../server/test/graph/graph-history-fixture';
import type { GraphHistoryResponse } from '../../lib/api/graph-history-types';
import type { GraphResponse } from '../../lib/api/graph-types';
import {
  compileHistory,
  mapCounts,
  MAX_WEEKS,
  weekList,
  weekResponse,
  weekSnapshot,
} from './graph-history-model';

/** The server's answer for the 6-week fixture, and its live map. */
function fixture(rows = LIVE_ROWS, lines = FIXTURE_LOG) {
  const state = createLogState();
  for (const line of lines) applyLogLine(state, line);
  const graph = buildGraph(rows);
  const history = buildGraphHistory(
    state,
    {
      graph,
      links: rows.links,
      notes: new Set(rows.notes.map((n) => n.path)),
      files: new Set(rows.files),
    },
    NOW,
  ) as GraphHistoryResponse;
  return { history, live: graph as GraphResponse };
}

const sorted = (response: GraphResponse) => ({
  nodes: response.nodes.map((n) => n.id).sort(),
  edges: response.edges.map((e) => edgeKey(e.source, e.target)).sort(),
});

describe('time scrubber model (F24.1)', () => {
  it('(F24.1) weeks run from the first event week to the current week', () => {
    const compiled = compileHistory(fixture().history);
    expect(compiled?.weeks).toEqual(WEEKS);
    expect(compiled?.weekEnds[0]).toBe(new Date(2026, 8, 21).getTime());
    expect(weekList('2026-10-05', '2026-10-19')).toEqual([
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ]);
    expect(weekList('1999-01-04', '2026-10-19')).toHaveLength(MAX_WEEKS);
  });

  it('(F24.1) each week shows exactly what existed at its end (same 6-week log as the server)', () => {
    const { history, live } = fixture();
    const compiled = compileHistory(history);
    if (!compiled) throw new Error('no history');
    WEEKS.forEach((monday, w) => {
      expect(sorted(weekResponse(compiled, w, live)), `week of ${monday}`).toEqual(
        EXPECTED_WEEKS[w],
      );
    });
    // The current week is the live map.
    expect(sorted(weekResponse(compiled, WEEKS.length - 1, live))).toEqual(sorted(live));
  });

  it('(F24.1) degrees, orphans and counts are those of the week; sources stay hollow', () => {
    const { history, live } = fixture();
    const compiled = compileHistory(history);
    if (!compiled) throw new Error('no history');
    const w3 = weekResponse(compiled, 2, live);
    expect(w3.nodes.find((n) => n.id === PROJECT)).toMatchObject({ degree: 1, orphan: false });
    expect(w3.nodes.find((n) => n.id === PDF)).toMatchObject({
      kind: 'source',
      title: 'bài giảng 1.pdf',
      group: 'resources',
    });
    expect(mapCounts(w3)).toEqual({ notes: 4, links: 4 });
    const w5 = weekSnapshot(compiled, 4);
    expect(w5.present[compiled.idIndex.get(DAILY) ?? -1]).toBe(0);
  });

  it('(F24.1) a deleted note is drawn from the history in the weeks it existed', () => {
    const rows = { ...LIVE_ROWS, notes: LIVE_ROWS.notes.filter((n) => n.path !== DAILY) };
    const { history, live } = fixture(
      { ...rows, links: rows.links.filter((l) => l.from !== DAILY) },
      FIXTURE_LOG.slice(0, -2),
    );
    const compiled = compileHistory(history);
    if (!compiled) throw new Error('no history');
    expect(live.nodes.some((n) => n.id === DAILY)).toBe(false);
    expect(weekResponse(compiled, 3, live).nodes.find((n) => n.id === DAILY)).toMatchObject({
      title: '2026-10-06',
      group: 'daily',
      kind: 'note',
    });
  });

  it('(F24.1) an empty log has no scrubber', () => {
    expect(
      compileHistory({
        firstWeek: null,
        currentWeek: '2026-10-19',
        exactSince: null,
        nodes: [],
        edges: [],
      }),
    ).toBeNull();
  });
});
