/**
 * "Vùng não đang hoạt động" (SPEC F24.3, design.md screen 6): notes edited in the last 24 hours
 * glow brighter and breathe on a 3 s period, driven by the view's motion clock. Under reduced
 * motion they keep a still, brighter glow and a ring in their colour instead. Per frame the cost
 * is one pass over the recent notes, drawn as one path per colour (the list is sorted by group).
 */
import type { FrameInput } from './graph-draw';
import { DIM_ALPHA, STATE_DIM, STATE_HIDDEN } from './graph-highlight';
import type { GraphModel } from './graph-model';

export const RECENT_MS = 24 * 60 * 60 * 1000;
export const PULSE_PERIOD_MS = 3_000;
/** `FrameInput.pulse` under reduced motion: a still highlight. */
export const PULSE_STATIC = -1;
/** Glow reach around the dot (screen px): at rest, and added at the top of a breath. */
const PULSE_GLOW_PX = 5;
const PULSE_GROW_PX = 4;
const PULSE_ALPHA_MIN = 0.14;
const PULSE_ALPHA_RANGE = 0.22;
const STATIC_GLOW_ALPHA = 0.3;
const RING_GAP_PX = 2.5;

/** Notes whose file changed in the 24 h before `nowMs`, sorted by colour group; null if none. */
export function recentNodeIndices(model: GraphModel, nowMs: number): Int32Array | null {
  const recent = model.nodes.filter(
    (node) => node.kind === 'note' && node.mtimeMs !== null && node.mtimeMs >= nowMs - RECENT_MS,
  );
  if (recent.length === 0) return null;
  recent.sort((a, b) => a.groupIndex - b.groupIndex || a.i - b.i);
  return Int32Array.from(recent, (node) => node.i);
}

/** Breath of the pulse at `clockMs`: 0 (rest) → 1 (full) → 0 over one period. */
export function pulseLevel(clockMs: number): number {
  return 0.5 - 0.5 * Math.cos((2 * Math.PI * clockMs) / PULSE_PERIOD_MS);
}

/** Adds circles of the recent nodes `recent[from…to)` in the given dim state; returns whether any. */
function trace(
  ctx: CanvasRenderingContext2D,
  f: FrameInput,
  from: number,
  to: number,
  dim: boolean,
  extra: number,
) {
  const recent = f.recent as Int32Array;
  let any = false;
  ctx.beginPath();
  for (let k = from; k < to; k++) {
    const i = recent[k] ?? 0;
    const state = f.highlight.nodeState[i];
    if (state === STATE_HIDDEN || (state === STATE_DIM) !== dim) continue;
    const r = (f.radius[i] ?? 0) + extra;
    const x = f.px[i] ?? 0;
    const y = f.py[i] ?? 0;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
    any = true;
  }
  return any;
}

/** Runs of `recent` with one colour group each. */
function forEachGroup(f: FrameInput, run: (from: number, to: number, group: number) => void) {
  const recent = f.recent as Int32Array;
  let from = 0;
  while (from < recent.length) {
    const group = f.model.nodes[recent[from] ?? 0]?.groupIndex ?? 0;
    let to = from + 1;
    while (to < recent.length && f.model.nodes[recent[to] ?? 0]?.groupIndex === group) to++;
    run(from, to, group);
    from = to;
  }
}

/** The breathing (or still) glow, drawn under the dots. */
export function drawPulseGlow(ctx: CanvasRenderingContext2D, f: FrameInput): void {
  if (!f.recent || f.recent.length === 0) return;
  const still = f.pulse === PULSE_STATIC;
  const level = still ? 1 : Math.min(1, Math.max(0, f.pulse));
  const extra = (PULSE_GLOW_PX + PULSE_GROW_PX * level) / f.view.scale;
  const alpha = still ? STATIC_GLOW_ALPHA : PULSE_ALPHA_MIN + PULSE_ALPHA_RANGE * level;
  forEachGroup(f, (from, to, group) => {
    ctx.fillStyle = f.palette.groups[group] ?? f.palette.edge;
    for (const dim of [false, true]) {
      if (!trace(ctx, f, from, to, dim, extra)) continue;
      ctx.globalAlpha = alpha * (dim ? DIM_ALPHA : 1);
      ctx.fill();
    }
  });
}

/** Under reduced motion: a ring in the note's colour, drawn over the dots. */
export function drawPulseRings(ctx: CanvasRenderingContext2D, f: FrameInput): void {
  if (!f.recent || f.recent.length === 0 || f.pulse !== PULSE_STATIC) return;
  ctx.lineWidth = 1.5 / f.view.scale;
  forEachGroup(f, (from, to, group) => {
    ctx.strokeStyle = f.palette.groups[group] ?? f.palette.edge;
    for (const dim of [false, true]) {
      if (!trace(ctx, f, from, to, dim, RING_GAP_PX / f.view.scale)) continue;
      ctx.globalAlpha = dim ? DIM_ALPHA : 1;
      ctx.stroke();
    }
  });
}
