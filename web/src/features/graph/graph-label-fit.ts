/**
 * Fit to the canvas with room for labels that must stay readable (a local graph's own note).
 * Labels are drawn in CSS px next to dots placed in world units, so the scale where both fit is
 * found by bisection: fitting only gets easier as the scale shrinks.
 */
import type { FrameInput } from './graph-draw';
import { LABEL_EDGE_PX, LABEL_GAP_PX, LABEL_HEIGHT_PX, labelWidth } from './graph-label-place';
import type { GraphScene } from './graph-scene';
import { fitPadding, fitViewport, MIN_SCALE, type Bounds, type Viewport } from './graph-viewport';

/** Closest a dot comes to the left or right edge when a name needs the room. */
const MIN_DOT_EDGE_PX = 16;

/** A label the fitted view keeps inside the canvas. */
export interface FitLabel {
  /** World position and radius of the labelled dot. */
  x: number;
  y: number;
  r: number;
  /** Label width in CSS px; the label is drawn right of the dot. */
  width: number;
}

/** One thing to keep on screen along one axis: `world × scale + px`, `margin` from the edge. */
interface AxisItem {
  low: number;
  high: number;
  lowPx: number;
  highPx: number;
  margin: number;
}

/** The offsets that keep every item inside [0, size] at `scale` (lower > upper: impossible). */
function axisRange(items: readonly AxisItem[], scale: number, size: number) {
  let lower = -Infinity;
  let upper = Infinity;
  for (const item of items) {
    lower = Math.max(lower, item.margin - (item.low * scale + item.lowPx));
    upper = Math.min(upper, size - item.margin - (item.high * scale + item.highPx));
  }
  return { lower, upper };
}

function axisItems(bounds: Bounds, labels: readonly FitLabel[], width: number, height: number) {
  const padding = fitPadding(width, height);
  // Across, the dots may come closer to the edge to make room for a name (a small canvas).
  const across = Math.min(padding, MIN_DOT_EDGE_PX);
  const xs: AxisItem[] = [
    { low: bounds.minX, high: bounds.maxX, lowPx: 0, highPx: 0, margin: across },
  ];
  const ys: AxisItem[] = [
    { low: bounds.minY, high: bounds.maxY, lowPx: 0, highPx: 0, margin: padding },
  ];
  for (const label of labels) {
    // A label wider than the canvas is shortened when drawn: fit the part that can show.
    const shown = Math.min(label.width, width - 2 * LABEL_EDGE_PX - LABEL_GAP_PX);
    const start = label.x + label.r;
    const half = LABEL_HEIGHT_PX / 2;
    xs.push({
      low: start,
      high: start,
      lowPx: LABEL_GAP_PX,
      highPx: LABEL_GAP_PX + shown,
      margin: LABEL_EDGE_PX,
    });
    ys.push({ low: label.y, high: label.y, lowPx: -half, highPx: half, margin: LABEL_EDGE_PX });
  }
  return { xs, ys };
}

/** Like `fitViewport`, and the largest scale at which `labels` fit beside their dots too. */
export function fitViewportWithLabels(
  view: Viewport,
  bounds: Bounds | null,
  width: number,
  height: number,
  labels: readonly FitLabel[],
): void {
  fitViewport(view, bounds, width, height);
  if (!bounds || labels.length === 0 || width <= 0 || height <= 0) return;
  const { xs, ys } = axisItems(bounds, labels, width, height);
  const fits = (scale: number) => {
    const x = axisRange(xs, scale, width);
    const y = axisRange(ys, scale, height);
    return x.lower <= x.upper && y.lower <= y.upper;
  };
  let high = view.scale;
  let low = Math.max(MIN_SCALE, high / 16);
  if (!fits(high)) {
    if (fits(low)) {
      for (let step = 0; step < 24; step++) {
        const mid = (low + high) / 2;
        if (fits(mid)) low = mid;
        else high = mid;
      }
    }
    view.scale = low;
  }
  // Centered in the room left; when nothing fits, the left and top edges win (the label start
  // stays in view and its end is shortened).
  const x = axisRange(xs, view.scale, width);
  const y = axisRange(ys, view.scale, height);
  view.tx = x.lower <= x.upper ? (x.lower + x.upper) / 2 : x.lower;
  view.ty = y.lower <= y.upper ? (y.lower + y.upper) / 2 : y.lower;
  view.fitScale = view.scale;
}

/** The scene's always-named note (a local graph's own note) as a label the fit keeps inside. */
export function pinnedFitLabels(
  ctx: CanvasRenderingContext2D | null,
  frame: FrameInput | null,
  scene: GraphScene | null,
): FitLabel[] {
  const node = scene?.model.nodes[scene.pinnedLabel];
  if (!ctx || !frame || !node) return [];
  ctx.font = frame.labelFont;
  return [
    { x: node.x ?? 0, y: node.y ?? 0, r: node.radius, width: labelWidth(ctx, frame, node.i) },
  ];
}
