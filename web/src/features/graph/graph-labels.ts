/**
 * Node names on the graph canvas, placed so they never pile up:
 * 1. highlighted names in `--ink`: the hovered node, the selected one and a local graph's own
 *    note always show; lit neighbours follow, nearest first;
 * 2. on the full map without a selection, quiet names in `--ink-2` for the most linked notes
 *    (`graph-ambient-labels.ts`).
 * Where one name may stand is decided in `graph-label-place.ts`.
 */
import { drawAmbientLabels } from './graph-ambient-labels';
import type { FrameInput } from './graph-draw';
import { placeLabel, resetPlacedLabels } from './graph-label-place';

export {
  AMBIENT_LABEL_RADIUS_PX,
  AMBIENT_LABELS_AT_FIT,
  ambientLabelBudget,
  HUB_LABELS_OVER_DOTS,
  MAX_AMBIENT_LABELS,
} from './graph-ambient-labels';
export { LABEL_EDGE_PX, LABEL_GAP_PX, LABEL_HEIGHT_PX, labelWidth } from './graph-label-place';

export function drawLabels(ctx: CanvasRenderingContext2D, f: FrameInput): void {
  const { highlight } = f;
  resetPlacedLabels();
  const ambient = f.ambientLabels && !highlight.dimming;
  if (highlight.labelCount === 0 && !ambient) return;
  f.labelPass = (f.labelPass + 1) >>> 0;
  if (f.labelPass === 0) {
    f.labelMark.fill(0);
    f.labelPass = 1;
  }
  ctx.setTransform(f.dpr, 0, 0, f.dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.font = f.labelFont;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = f.palette.background;
  ctx.fillStyle = f.palette.ink;
  for (let k = 0; k < highlight.labelCount; k++) {
    placeLabel(ctx, f, highlight.labels[k] ?? 0, k < highlight.forcedLabels ? 'forced' : 'lit');
  }
  if (ambient) drawAmbientLabels(ctx, f);
}
