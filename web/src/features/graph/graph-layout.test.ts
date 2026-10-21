// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { LAYOUT_BUDGET_MS, isSettling, layoutGraph, positionsOf, settleNow } from './graph-layout';
import { buildGraphModel } from './graph-model';
import { generatedGraph, graphNode, graphResponse } from './__tests__/graph-test-helpers';

describe('graph layout: 3,000 nodes / 6,000 edges (F16.1)', () => {
  it('lays out within 3 s', () => {
    const model = buildGraphModel(generatedGraph(3_000, 6_000));
    expect(model.nodes).toHaveLength(3_000);
    expect(model.edgeSource).toHaveLength(6_000);
    const start = performance.now();
    const result = layoutGraph(model);
    const elapsed = performance.now() - start;
    console.info(
      `[graph layout] 3000 nodes / 6000 edges: ${elapsed.toFixed(0)} ms, ${result.ticks} ticks` +
        ` (sync run ${result.elapsedMs.toFixed(0)} ms, budget ${LAYOUT_BUDGET_MS} ms)`,
    );
    expect(elapsed).toBeLessThanOrEqual(3_000);
    expect(result.ticks).toBeGreaterThan(0);
    for (const node of model.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  }, 20_000);
});

describe('graph layout: determinism and refresh', () => {
  const small = () => generatedGraph(60, 90, 3);

  it('gives the same positions for the same graph', () => {
    const first = buildGraphModel(small());
    const second = buildGraphModel(small());
    layoutGraph(first);
    layoutGraph(second);
    expect(positionsOf(second)).toEqual(positionsOf(first));
  });

  it('keeps existing positions on refresh and places a new note next to its neighbour', () => {
    const before = buildGraphModel(
      graphResponse(
        [graphNode('a.md'), graphNode('b.md'), graphNode('c.md')],
        [
          ['a.md', 'b.md'],
          ['b.md', 'c.md'],
        ],
      ),
    );
    settleNow(layoutGraph(before).simulation);
    const previous = positionsOf(before);
    const after = buildGraphModel(
      graphResponse(
        [graphNode('a.md'), graphNode('b.md'), graphNode('c.md'), graphNode('d.md')],
        [
          ['a.md', 'b.md'],
          ['b.md', 'c.md'],
          ['c.md', 'd.md'],
        ],
      ),
    );
    const result = layoutGraph(after, { previous });
    for (const id of ['a.md', 'b.md', 'c.md']) {
      const node = after.nodes[after.indexById.get(id) ?? -1];
      expect({ x: node?.x, y: node?.y }).toEqual(previous.get(id));
      expect(node?.fx).toBeNull();
    }
    const d = after.nodes[after.indexById.get('d.md') ?? -1];
    const c = previous.get('c.md');
    expect(Math.hypot((d?.x ?? 0) - (c?.x ?? 0), (d?.y ?? 0) - (c?.y ?? 0))).toBeLessThan(100);
    expect(isSettling(result.simulation)).toBe(false);
  });

  it('does not move anything when a refresh brings no new node', () => {
    const model = buildGraphModel(small());
    layoutGraph(model);
    const previous = positionsOf(model);
    const again = buildGraphModel(small());
    const result = layoutGraph(again, { previous });
    expect(result.ticks).toBe(0);
    expect(positionsOf(again)).toEqual(previous);
  });
});
