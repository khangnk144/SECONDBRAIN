/**
 * Uniform-grid spatial index for pointer hit tests (a flat stand-in for a quadtree: node sizes
 * are close to each other, so equal cells work as well and cost nothing to rebuild). Built from
 * the layout positions and rebuilt only when they change (ticks, drag, new data), not when dots
 * merely drift: queries widen by the drift margin and check exact distances on the drawn positions.
 */
const MIN_CELL = 16;
/** Keeps the cell table proportional to the node count even for a very spread-out layout. */
const MAX_CELLS_PER_NODE = 4;

export interface HitPoints {
  /** Layout positions the grid is built from. */
  readonly baseX: ArrayLike<number>;
  readonly baseY: ArrayLike<number>;
  readonly radius: ArrayLike<number>;
  readonly count: number;
}

export class HitGrid {
  private cell = MIN_CELL;
  private minX = 0;
  private minY = 0;
  private cols = 0;
  private rows = 0;
  private cellStart = new Int32Array(1);
  private entries = new Int32Array(0);
  private maxRadius = 0;

  build(points: HitPoints): void {
    const { baseX, baseY, radius, count } = points;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    this.maxRadius = 0;
    for (let i = 0; i < count; i++) {
      const x = baseX[i] ?? 0;
      const y = baseY[i] ?? 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      this.maxRadius = Math.max(this.maxRadius, radius[i] ?? 0);
    }
    if (count === 0) {
      this.cols = 0;
      this.rows = 0;
      return;
    }
    const area = Math.max(1, (maxX - minX) * (maxY - minY));
    this.cell = Math.max(
      MIN_CELL,
      this.maxRadius * 2,
      Math.sqrt(area / (count * MAX_CELLS_PER_NODE)),
    );
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.floor((maxX - minX) / this.cell) + 1;
    this.rows = Math.floor((maxY - minY) / this.cell) + 1;
    // Counting sort of node indices by cell.
    const cells = this.cols * this.rows;
    const start = new Int32Array(cells + 1);
    const cellOf = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const c = this.cellIndex(baseX[i] ?? 0, baseY[i] ?? 0);
      cellOf[i] = c;
      start[c + 1] = (start[c + 1] ?? 0) + 1;
    }
    for (let c = 0; c < cells; c++) start[c + 1] = (start[c + 1] ?? 0) + (start[c] ?? 0);
    const fill = start.slice(0, cells);
    const entries = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const c = cellOf[i] ?? 0;
      entries[fill[c] ?? 0] = i;
      fill[c] = (fill[c] ?? 0) + 1;
    }
    this.cellStart = start;
    this.entries = entries;
  }

  private cellIndex(x: number, y: number): number {
    const col = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cell)));
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.minY) / this.cell)));
    return row * this.cols + col;
  }

  /**
   * Nearest node whose drawn circle (radius + `slack`) contains (x, y), or -1. `drawnX/Y` are the
   * positions on screen in world units; `margin` is how far they may be from the layout ones.
   */
  find(
    x: number,
    y: number,
    slack: number,
    margin: number,
    drawnX: ArrayLike<number>,
    drawnY: ArrayLike<number>,
    radius: ArrayLike<number>,
  ): number {
    if (this.cols === 0) return -1;
    const reach = this.maxRadius + slack + margin;
    const col0 = Math.max(0, Math.floor((x - reach - this.minX) / this.cell));
    const col1 = Math.min(this.cols - 1, Math.floor((x + reach - this.minX) / this.cell));
    const row0 = Math.max(0, Math.floor((y - reach - this.minY) / this.cell));
    const row1 = Math.min(this.rows - 1, Math.floor((y + reach - this.minY) / this.cell));
    let best = -1;
    let bestDistance = Infinity;
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        const c = row * this.cols + col;
        for (let k = this.cellStart[c] ?? 0; k < (this.cellStart[c + 1] ?? 0); k++) {
          const i = this.entries[k] ?? 0;
          const dx = (drawnX[i] ?? 0) - x;
          const dy = (drawnY[i] ?? 0) - y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance <= (radius[i] ?? 0) + slack && distance < bestDistance) {
            best = i;
            bestDistance = distance;
          }
        }
      }
    }
    return best;
  }
}

/** Same answer without an index (used while the intro scales every position). */
export function findNearestLinear(
  x: number,
  y: number,
  slack: number,
  count: number,
  drawnX: ArrayLike<number>,
  drawnY: ArrayLike<number>,
  radius: ArrayLike<number>,
): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < count; i++) {
    const distance = Math.hypot((drawnX[i] ?? 0) - x, (drawnY[i] ?? 0) - y);
    if (distance <= (radius[i] ?? 0) + slack && distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}
