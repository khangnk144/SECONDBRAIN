import { describe, expect, it } from 'vitest';
import { seededRandom } from './graph-layout';
import { HitGrid, findNearestLinear } from './graph-hit-grid';

describe('graph hit test grid', () => {
  it('answers like a scan of every node, for random points', () => {
    const random = seededRandom(11);
    const count = 3_000;
    const baseX = Float32Array.from({ length: count }, () => (random() - 0.5) * 2_000);
    const baseY = Float32Array.from({ length: count }, () => (random() - 0.5) * 2_000);
    const radius = Float32Array.from({ length: count }, () => 4 + random() * 4);
    const grid = new HitGrid();
    grid.build({ baseX, baseY, radius, count });
    for (let k = 0; k < 500; k++) {
      const x = (random() - 0.5) * 2_000;
      const y = (random() - 0.5) * 2_000;
      expect(grid.find(x, y, 4, 0, baseX, baseY, radius)).toBe(
        findNearestLinear(x, y, 4, count, baseX, baseY, radius),
      );
    }
  });

  it('picks the nearest of two overlapping dots and finds drifted dots within the margin', () => {
    const baseX = Float32Array.from([0, 6, 300]);
    const baseY = Float32Array.from([0, 0, 0]);
    const radius = Float32Array.from([5, 5, 5]);
    const grid = new HitGrid();
    grid.build({ baseX, baseY, radius, count: 3 });
    expect(grid.find(4, 0, 0, 0, baseX, baseY, radius)).toBe(1);
    expect(grid.find(50, 50, 4, 0, baseX, baseY, radius)).toBe(-1);
    // Drawn 3 units away from the layout position: still hit with a margin of 3.
    const drawnX = Float32Array.from([0, 6, 303]);
    expect(grid.find(308, 0, 0, 3, drawnX, baseY, radius)).toBe(2);
  });
});
