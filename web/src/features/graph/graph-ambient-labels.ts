/**
 * Quiet names (`--ink-2`) on the full map without a selection: the most linked notes (course
 * notes and other hubs) are named without a hover, a few at the default zoom and more as the view
 * zooms in, like a label that appears once its note is big enough on screen.
 * Rule: visible notes are taken most links first; the first `ambientLabelBudget` of them are
 * candidates (one that finds no free spot still uses its turn, so a crowded hub is never replaced
 * by a minor note). Any dot of `AMBIENT_LABEL_RADIUS_PX` or more on screen is a candidate too
 * (a small vault, a deep zoom). The first `HUB_LABELS_OVER_DOTS` candidates may cross other dots
 * when no clean spot is left; every other quiet name keeps off dots.
 */
import type { FrameInput } from './graph-draw';
import { buildDotObstacles } from './graph-label-obstacles';
import { HIDDEN, MAX_PLACED_LABELS, PLACED, placeLabel } from './graph-label-place';
import { MAX_LABELS } from './graph-highlight';

/** Candidates at the default (fitted) zoom: only the top hubs, so the map stays calm. */
export const AMBIENT_LABELS_AT_FIT = 15;
export const MAX_AMBIENT_LABELS = MAX_PLACED_LABELS - MAX_LABELS;
/** A dot this large on screen may be named whatever its rank. */
export const AMBIENT_LABEL_RADIUS_PX = 8;
/** The biggest hubs keep their names even in a crowded core. */
export const HUB_LABELS_OVER_DOTS = 5;

/**
 * How many of the most linked visible notes are candidates: `AMBIENT_LABELS_AT_FIT` at the fitted
 * zoom, growing with the zoomed area (×4 at twice the zoom) up to `MAX_AMBIENT_LABELS`.
 */
export function ambientLabelBudget(scale: number, fitScale: number): number {
  const zoom = fitScale > 0 ? scale / fitScale : 1;
  return Math.min(MAX_AMBIENT_LABELS, Math.round(AMBIENT_LABELS_AT_FIT * zoom * zoom));
}

export function drawAmbientLabels(ctx: CanvasRenderingContext2D, f: FrameInput): void {
  const { highlight, model, view } = f;
  const budget = ambientLabelBudget(view.scale, view.fitScale);
  ctx.fillStyle = f.palette.quietInk;
  buildDotObstacles(f);
  let tried = 0;
  let placed = 0;
  for (let k = 0; k < highlight.ambientOrder.length && placed < MAX_AMBIENT_LABELS; k++) {
    const i = highlight.ambientOrder[k] ?? 0;
    if (f.labelMark[i] === f.labelPass) continue;
    const ranked = tried < budget && (model.nodes[i]?.degree ?? 0) > 0;
    const kind = ranked && tried < HUB_LABELS_OVER_DOTS ? 'hub' : 'quiet';
    const result = placeLabel(ctx, f, i, kind, ranked ? 0 : AMBIENT_LABEL_RADIUS_PX);
    if (result === HIDDEN) continue;
    if (ranked) tried++;
    if (result === PLACED) placed++;
  }
}
