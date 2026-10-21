/**
 * Draws one frame of the graph on a 2D canvas. Called at frame rate while anything moves, so it
 * allocates nothing: positions come in typed arrays, nodes are filled bucket by bucket (one
 * path per color and opacity), and every style value is precomputed.
 */
import {
  ALPHA_CLASSES,
  BUCKETS,
  DIM_ALPHA,
  STATE_DIM,
  STATE_EMPHASIS,
  STATE_NORMAL,
  type GraphHighlight,
} from './graph-highlight';
import { drawAiTouchHalos, drawAiTouchLabels, drawAiTouchMarks } from './graph-ai-touch-draw';
import type { TouchFrame } from './graph-ai-touch-effect';
import { drawLabels } from './graph-labels';
import type { GraphModel } from './graph-model';
import type { GraphPalette } from './graph-palette';
import type { Viewport } from './graph-viewport';

/** SPEC F16: edges at 25 % opacity. */
export const EDGE_ALPHA = 0.25;
const EMPHASIS_EDGE_ALPHA = 0.7;
/** One subtle glow layer per dot, a small ring of light around it (design.md screen 6, §6). */
export const GLOW_EXTRA_PX = 4;
export const GLOW_ALPHA = 0.12;
const EMPHASIS_GLOW_ALPHA = 0.22;
const SIGNAL_RADIUS_PX = 2.5;
const MAX_SIGNALS = 600;

export interface FrameInput {
  model: GraphModel;
  highlight: GraphHighlight;
  palette: GraphPalette;
  /** Label font, built from the palette's family once. */
  labelFont: string;
  view: Viewport;
  width: number;
  height: number;
  dpr: number;
  /** Drawn positions in world units (layout + intro + drift). */
  px: Float32Array;
  py: Float32Array;
  radius: Float32Array;
  /** Selected node (accent ring) or -1. */
  ring: number;
  hover: number;
  /** Signal along edges: 0 → 1 while running, -1 when idle. */
  signalProgress: number;
  /** The signal runs from nodes at this level to the next one. */
  signalFromLevel: number;
  levels: Int8Array | null;
  /** Names of the biggest hubs without a hover, more as the view zooms in (full map only). */
  ambientLabels: boolean;
  /** Label widths in CSS px per node, measured on first use (NaN until then). */
  labelWidths: Float32Array;
  /** `labelMark[i] === labelPass`: node `i` is already named in the frame being drawn. */
  labelMark: Uint32Array;
  labelPass: number;
  /** Canvas areas under overlays (title, controls, legend) that names keep off, CSS px. */
  labelExclusions: readonly LabelRect[];
  /** "AI vừa chạm" playbacks on screen (full map only), or null. */
  touch: TouchFrame | null;
}

export interface LabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function strokeEdges(ctx: CanvasRenderingContext2D, f: FrameInput, state: number): void {
  const { model, highlight, px, py } = f;
  ctx.beginPath();
  for (let e = 0; e < model.edgeSource.length; e++) {
    if (highlight.edgeState[e] !== state) continue;
    const a = model.edgeSource[e] ?? 0;
    const b = model.edgeTarget[e] ?? 0;
    ctx.moveTo(px[a] ?? 0, py[a] ?? 0);
    ctx.lineTo(px[b] ?? 0, py[b] ?? 0);
  }
  ctx.stroke();
}

/** Fills (notes) or strokes (sources) every non-empty bucket; `grow` widens the circles (glow). */
function drawBuckets(
  ctx: CanvasRenderingContext2D,
  f: FrameInput,
  hollow: boolean,
  grow: number,
  alphaFactor: number,
  emphasisAlphaFactor: number,
): void {
  const { highlight, px, py, radius, palette } = f;
  const first = hollow ? BUCKETS / 2 : 0;
  for (let b = first; b < first + BUCKETS / 2; b++) {
    const start = highlight.bucketStart[b] ?? 0;
    const end = highlight.bucketStart[b + 1] ?? 0;
    if (start === end) continue;
    const local = b - first;
    const emphasis = local % ALPHA_CLASSES === 0;
    const color = palette.groups[Math.floor(local / ALPHA_CLASSES)] ?? palette.edge;
    ctx.globalAlpha =
      (highlight.bucketAlpha[b] ?? 1) * (emphasis ? emphasisAlphaFactor : alphaFactor);
    ctx.beginPath();
    for (let k = start; k < end; k++) {
      const i = highlight.order[k] ?? 0;
      const r = (radius[i] ?? 0) + grow;
      const x = px[i] ?? 0;
      const y = py[i] ?? 0;
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    if (hollow) {
      ctx.strokeStyle = color;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
}

function drawSignals(ctx: CanvasRenderingContext2D, f: FrameInput): void {
  const { model, levels, px, py, signalProgress: t, signalFromLevel: from } = f;
  if (!levels || t < 0) return;
  ctx.globalAlpha = 1;
  ctx.fillStyle = f.palette.accent;
  ctx.beginPath();
  const r = SIGNAL_RADIUS_PX / f.view.scale;
  let drawn = 0;
  for (let e = 0; e < model.edgeSource.length && drawn < MAX_SIGNALS; e++) {
    const s = model.edgeSource[e] ?? 0;
    const d = model.edgeTarget[e] ?? 0;
    let a: number;
    let b: number;
    if (levels[s] === from && levels[d] === from + 1) {
      a = s;
      b = d;
    } else if (levels[d] === from && levels[s] === from + 1) {
      a = d;
      b = s;
    } else continue;
    const x = (px[a] ?? 0) + ((px[b] ?? 0) - (px[a] ?? 0)) * t;
    const y = (py[a] ?? 0) + ((py[b] ?? 0) - (py[a] ?? 0)) * t;
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
    drawn++;
  }
  ctx.fill();
}

function drawRing(ctx: CanvasRenderingContext2D, f: FrameInput, i: number, color: string) {
  if (i < 0) return;
  const gap = 3 / f.view.scale;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 / f.view.scale;
  ctx.beginPath();
  ctx.arc(f.px[i] ?? 0, f.py[i] ?? 0, (f.radius[i] ?? 0) + gap, 0, Math.PI * 2);
  ctx.stroke();
}

export function drawGraph(ctx: CanvasRenderingContext2D, f: FrameInput): void {
  const { view, dpr, palette } = f;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, f.width, f.height);
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty);

  ctx.lineWidth = 1 / view.scale;
  ctx.strokeStyle = palette.edge;
  ctx.globalAlpha = EDGE_ALPHA;
  strokeEdges(ctx, f, STATE_NORMAL);
  ctx.globalAlpha = EDGE_ALPHA * DIM_ALPHA;
  strokeEdges(ctx, f, STATE_DIM);
  ctx.strokeStyle = palette.accent;
  ctx.globalAlpha = EMPHASIS_EDGE_ALPHA;
  ctx.lineWidth = 1.5 / view.scale;
  strokeEdges(ctx, f, STATE_EMPHASIS);

  drawAiTouchHalos(ctx, f);
  drawBuckets(ctx, f, false, GLOW_EXTRA_PX / view.scale, GLOW_ALPHA, EMPHASIS_GLOW_ALPHA);
  drawBuckets(ctx, f, false, 0, 1, 1);
  ctx.lineWidth = 1.25 / view.scale;
  drawBuckets(ctx, f, true, 0, 1, 1);

  drawSignals(ctx, f);
  drawAiTouchMarks(ctx, f);
  if (f.hover !== f.ring) drawRing(ctx, f, f.hover, palette.ink);
  drawRing(ctx, f, f.ring, palette.accent);
  drawLabels(ctx, f);
  drawAiTouchLabels(ctx, f);
}
