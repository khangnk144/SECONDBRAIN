/**
 * Drawing "AI vừa chạm" on top of the map: a soft accent halo under each lit output, an accent
 * ring around the source, a hollow dot (and its name) for a source drawn at the canvas edge, and
 * the signal dots on their way. Runs only while a playback is on screen.
 */
import { GRAPH_GROUPS } from '../../lib/api/graph-types';
import type { FrameInput } from './graph-draw';
import { SOURCE_RADIUS } from './graph-model';
import { LABEL_EDGE_PX, LABEL_GAP_PX } from './graph-label-place';

/** Halo around a lit output: this much wider than the dot (CSS px), at this opacity. */
export const HALO_EXTRA_PX = 6;
export const HALO_ALPHA = 0.35;
const RING_GAP_PX = 3;
const SIGNAL_RADIUS_PX = 2.5;
/** Half the height of a source's name line (CSS px), for keeping it off the overlays. */
const HALF_LINE_PX = 8;
const RESOURCES = GRAPH_GROUPS.indexOf('resources');

/** Under the dots: the halos of lit outputs. */
export function drawAiTouchHalos(ctx: CanvasRenderingContext2D, f: FrameInput): void {
  const touch = f.touch;
  if (!touch || touch.plays.length === 0) return;
  ctx.fillStyle = f.palette.accent;
  const extra = HALO_EXTRA_PX / f.view.scale;
  for (const play of touch.plays) {
    for (let k = 0; k < play.outputs.length; k++) {
      const alpha = play.litAlpha[k] ?? 0;
      const i = play.outputs[k] ?? -1;
      if (alpha <= 0 || i < 0) continue;
      const x = f.px[i] ?? 0;
      const y = f.py[i] ?? 0;
      const r = (f.radius[i] ?? 0) + extra;
      ctx.globalAlpha = HALO_ALPHA * alpha;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Over the dots: the source (ring, or its own hollow dot at the edge) and the signals. */
export function drawAiTouchMarks(ctx: CanvasRenderingContext2D, f: FrameInput): void {
  const touch = f.touch;
  if (!touch || touch.plays.length === 0) return;
  const scale = f.view.scale;
  for (const play of touch.plays) {
    const grow = play.sourceScale;
    if (grow <= 0) continue;
    const base = play.ghost ? SOURCE_RADIUS : (f.radius[play.sourceIndex] ?? SOURCE_RADIUS);
    ctx.globalAlpha = Math.min(1, grow);
    if (play.ghost) {
      ctx.strokeStyle = f.palette.groups[RESOURCES] ?? f.palette.accent;
      ctx.lineWidth = 1.25 / scale;
      ctx.beginPath();
      ctx.arc(play.sourceX, play.sourceY, SOURCE_RADIUS * grow, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = f.palette.accent;
    ctx.lineWidth = 1.5 / scale;
    ctx.beginPath();
    ctx.arc(play.sourceX, play.sourceY, (base + RING_GAP_PX / scale) * grow, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = f.palette.accent;
  const r = SIGNAL_RADIUS_PX / scale;
  for (const play of touch.plays) {
    for (let k = 0; k < play.outputs.length; k++) {
      const t = play.signal[k] ?? -1;
      const i = play.outputs[k] ?? -1;
      if (t < 0 || i < 0) continue;
      const x = play.sourceX + ((f.px[i] ?? 0) - play.sourceX) * t;
      const y = play.sourceY + ((f.py[i] ?? 0) - play.sourceY) * t;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Names of sources drawn at the edge (map nodes are named by the label pass). Screen space. */
export function drawAiTouchLabels(ctx: CanvasRenderingContext2D, f: FrameInput): void {
  const touch = f.touch;
  if (!touch || touch.plays.length === 0) return;
  const { view } = f;
  ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  ctx.font = f.labelFont;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = f.palette.background;
  ctx.fillStyle = f.palette.ink;
  for (const play of touch.plays) {
    if (!play.ghost || play.sourceScale <= 0) continue;
    const sx = play.sourceX * view.scale + view.tx;
    const sy = play.sourceY * view.scale + view.ty;
    const width = ctx.measureText(play.sourceTitle).width;
    const gap = SOURCE_RADIUS + RING_GAP_PX + LABEL_GAP_PX;
    const right = sx + gap;
    const left = sx - gap - width;
    const free = (x: number) =>
      x >= LABEL_EDGE_PX &&
      x + width <= f.width - LABEL_EDGE_PX &&
      !f.labelExclusions.some(
        (r) =>
          x < r.x + r.width &&
          x + width > r.x &&
          sy + HALF_LINE_PX > r.y &&
          sy - HALF_LINE_PX < r.y + r.height,
      );
    // Right of the dot, else left of it when that side is inside the canvas and off the overlays.
    let x = [right, left].find(free) ?? right;
    if (!free(x) && x + width > f.width - LABEL_EDGE_PX) x = Math.max(LABEL_EDGE_PX, left);
    ctx.globalAlpha = Math.min(1, play.sourceScale);
    ctx.strokeText(play.sourceTitle, x, sy);
    ctx.fillText(play.sourceTitle, x, sy);
  }
  ctx.globalAlpha = 1;
}
