/**
 * Dots a quiet name must not cover, so names never sit on top of other notes. Built per drawn
 * frame into a screen-space bucket grid (typed arrays reused, grown only when the canvas or the
 * graph grows), from the dots' resting places like the rest of the label placement.
 * Dots smaller than `OBSTACLE_MIN_RADIUS_PX` are specks a name may cross; otherwise a big vault
 * at the default zoom, where dots are 1 px apart, could name nothing at all.
 */
import type { FrameInput } from './graph-draw';

export const OBSTACLE_MIN_RADIUS_PX = 2.5;
/** Room kept between a name and a dot it passes. */
const DOT_CLEARANCE_PX = 2;
const CELL_PX = 32;

let cols = 0;
let rows = 0;
let maxRadius = 0;
let cellStart = new Int32Array(1);
let cellFill = new Int32Array(1);
let entries = new Int32Array(0);
let cellOf = new Int32Array(0);
let dotX = new Float32Array(0);
let dotY = new Float32Array(0);
let dotR = new Float32Array(0);

function ensureCapacity(cells: number, nodes: number): void {
  if (cellStart.length < cells + 1) {
    cellStart = new Int32Array(cells + 1);
    cellFill = new Int32Array(cells);
  }
  if (cellOf.length < nodes) {
    cellOf = new Int32Array(nodes);
    entries = new Int32Array(nodes);
    dotX = new Float32Array(nodes);
    dotY = new Float32Array(nodes);
    dotR = new Float32Array(nodes);
  }
}

/** Indexes the visible dots of this frame. */
export function buildDotObstacles(f: FrameInput): void {
  const { model, view, width, height, radius } = f;
  const n = model.nodes.length;
  cols = Math.max(1, Math.ceil(width / CELL_PX));
  rows = Math.max(1, Math.ceil(height / CELL_PX));
  const cells = cols * rows;
  ensureCapacity(cells, n);
  cellStart.fill(0, 0, cells + 1);
  maxRadius = 0;
  for (let i = 0; i < n; i++) {
    const node = model.nodes[i];
    const r = (radius[i] ?? 0) * view.scale;
    const x = (node?.x ?? 0) * view.scale + view.tx;
    const y = (node?.y ?? 0) * view.scale + view.ty;
    if (r < OBSTACLE_MIN_RADIUS_PX || x + r < 0 || y + r < 0 || x - r > width || y - r > height) {
      cellOf[i] = -1;
      continue;
    }
    const col = Math.min(cols - 1, Math.max(0, Math.floor(x / CELL_PX)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(y / CELL_PX)));
    const c = row * cols + col;
    cellOf[i] = c;
    cellStart[c + 1] = (cellStart[c + 1] ?? 0) + 1;
    dotX[i] = x;
    dotY[i] = y;
    dotR[i] = r;
    if (r > maxRadius) maxRadius = r;
  }
  for (let c = 0; c < cells; c++) {
    cellStart[c + 1] = (cellStart[c + 1] ?? 0) + (cellStart[c] ?? 0);
    cellFill[c] = cellStart[c] ?? 0;
  }
  for (let i = 0; i < n; i++) {
    const c = cellOf[i] ?? -1;
    if (c < 0) continue;
    entries[cellFill[c] ?? 0] = i;
    cellFill[c] = (cellFill[c] ?? 0) + 1;
  }
}

/** True when the box (x, top, width, height) comes near a dot other than node `except`. */
export function coversDot(
  x: number,
  top: number,
  width: number,
  height: number,
  except: number,
): boolean {
  const reach = maxRadius + DOT_CLEARANCE_PX;
  const col0 = Math.max(0, Math.floor((x - reach) / CELL_PX));
  const col1 = Math.min(cols - 1, Math.floor((x + width + reach) / CELL_PX));
  const row0 = Math.max(0, Math.floor((top - reach) / CELL_PX));
  const row1 = Math.min(rows - 1, Math.floor((top + height + reach) / CELL_PX));
  for (let row = row0; row <= row1; row++) {
    for (let col = col0; col <= col1; col++) {
      const c = row * cols + col;
      for (let k = cellStart[c] ?? 0; k < (cellStart[c + 1] ?? 0); k++) {
        const j = entries[k] ?? 0;
        if (j === except) continue;
        const cx = dotX[j] ?? 0;
        const cy = dotY[j] ?? 0;
        const dx = cx - Math.max(x, Math.min(cx, x + width));
        const dy = cy - Math.max(top, Math.min(cy, top + height));
        const keep = (dotR[j] ?? 0) + DOT_CLEARANCE_PX;
        if (dx * dx + dy * dy < keep * keep) return true;
      }
    }
  }
  return false;
}
