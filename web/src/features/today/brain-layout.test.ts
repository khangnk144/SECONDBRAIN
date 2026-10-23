import { describe, expect, it } from 'vitest';
import type { TodayBrainNode } from '../../lib/api/deadlines-types';
import { layoutBrain, type BrainLayoutBox } from './brain-layout';

const BOX: BrainLayoutBox = { width: 160, height: 84, minR: 3.5, maxR: 8, limit: 24 };
const nodes: TodayBrainNode[] = Array.from({ length: 30 }, (_, i) => ({
  path: `2 Areas/Ghi chú ${i}.md`,
  title: `Ghi chú ${i}`,
  group: 'areas',
}));
const edges = [
  { from: nodes[1]!.path, to: nodes[0]!.path },
  { from: nodes[2]!.path, to: nodes[0]!.path },
  { from: nodes[29]!.path, to: nodes[0]!.path }, // node 29 is not drawn (limit 24)
];

describe('"Não hôm nay" layout (F24.4)', () => {
  it('is deterministic, stays inside the box and draws only links between drawn dots', () => {
    const a = layoutBrain({ nodes, edges }, BOX);
    const b = layoutBrain({ nodes: nodes.map((n) => ({ ...n })), edges: [...edges] }, BOX);
    expect(b).toEqual(a);
    expect(a.nodes).toHaveLength(24);
    for (const node of a.nodes) {
      expect(node.x - node.r).toBeGreaterThanOrEqual(0);
      expect(node.x + node.r).toBeLessThanOrEqual(BOX.width);
      expect(node.y - node.r).toBeGreaterThanOrEqual(0);
      expect(node.y + node.r).toBeLessThanOrEqual(BOX.height);
    }
    expect(a.edges).toHaveLength(2);
    // The hub (two links) is the biggest dot; unlinked dots are the smallest.
    expect(a.nodes[0]?.r).toBe(BOX.maxR);
    expect(a.nodes[5]?.r).toBe(BOX.minR);
  });

  it('spreads the dots: no two share a spot', () => {
    const { nodes: placed } = layoutBrain({ nodes: nodes.slice(0, 8), edges: [] }, BOX);
    const spots = new Set(placed.map((n) => `${n.x},${n.y}`));
    expect(spots.size).toBe(8);
  });
});
