import { describe, expect, it } from 'vitest';
import type { GraphHistoryResponse } from '../../lib/api/graph-history-types';
import { compileHistory, weekResponse } from './graph-history-model';
import { buildWeekScene, historyOnlyPositions } from './graph-week-scene';
import { graphNode, graphResponse, staticScene } from './__tests__/graph-test-helpers';

const A = '2 Areas/Giải tích 1.md';
const B = '1 Projects/Đồ án.md';
const GONE = '0 Inbox/Đã xoá.md';
const LONELY = '0 Inbox/Một mình.md';
const day = (d: number) => new Date(2026, 9, d).getTime();

const history: GraphHistoryResponse = {
  firstWeek: '2026-10-05',
  currentWeek: '2026-10-19',
  exactSince: day(5),
  nodes: [
    { id: A, kind: 'note', firstSeen: day(5) },
    { id: B, kind: 'note', firstSeen: day(6) },
    {
      id: GONE,
      kind: 'note',
      firstSeen: day(6),
      removedAt: day(14),
      title: 'Đã xoá',
      group: 'other',
      class: 'user',
    },
    {
      id: LONELY,
      kind: 'note',
      firstSeen: day(6),
      removedAt: day(15),
      title: 'Một mình',
      group: 'other',
      class: 'user',
    },
  ],
  edges: [
    { from: A, to: B, addedAt: day(6) },
    { from: GONE, to: A, addedAt: day(7), removedAt: day(14) },
  ],
};

describe('week scenes keep the live layout (F24.1)', () => {
  const liveResponse = graphResponse([graphNode(A), graphNode(B)], [[A, B]]);
  const live = staticScene(liveResponse, (i) => ({ x: i * 100, y: 50 }));
  const compiled = compileHistory(history);
  if (!compiled) throw new Error('no history');

  it('(F24.1) live nodes stay where they are and sway in step', () => {
    const scene = buildWeekScene(weekResponse(compiled, 0, liveResponse), live, new Map());
    for (const id of [A, B]) {
      const i = scene.model.indexById.get(id) ?? -1;
      const j = live.model.indexById.get(id) ?? -1;
      expect([scene.model.nodes[i]?.x, scene.model.nodes[i]?.y]).toEqual([
        live.model.nodes[j]?.x,
        live.model.nodes[j]?.y,
      ]);
    }
    expect(scene.simulation.alpha()).toBe(0);
  });

  it('(F24.1) a deleted note sits by its old neighbours; an unlinked one on a ring outside', () => {
    const spots = historyOnlyPositions(compiled, live.model);
    const gone = spots.get(GONE);
    // Next to A (0, 50), 24 units away.
    expect(Math.hypot((gone?.x ?? 0) - 0, (gone?.y ?? 0) - 50)).toBeCloseTo(24);
    const lonely = spots.get(LONELY);
    const reach = Math.hypot(100, 50);
    expect(Math.hypot(lonely?.x ?? 0, lonely?.y ?? 0)).toBeCloseTo(reach + 60);
    expect(spots.has(A)).toBe(false);
    const scene = buildWeekScene(weekResponse(compiled, 0, liveResponse), live, spots);
    const i = scene.model.indexById.get(GONE) ?? -1;
    expect(scene.model.nodes[i]).toMatchObject({ x: gone?.x, y: gone?.y, title: 'Đã xoá' });
  });
});
