/**
 * Placing one node name on the canvas. A name goes right of its dot, or left when the right side
 * leaves the canvas or touches a name already placed or an overlay (title, controls, legend);
 * quiet names also keep off other dots, except the biggest hubs, which may cross dots when no
 * clean spot is left. A name that fits nowhere is skipped. Always-shown names stay inside the
 * canvas instead, shortened with "…" only when the canvas is too narrow for them.
 * Placement uses the dots' resting places (no drift), so names do not blink as the map breathes.
 */
import type { FrameInput } from './graph-draw';
import { MAX_LABELS } from './graph-highlight';
import { coversDot } from './graph-label-obstacles';
import { DRIFT_AMPLITUDE_PX } from './graph-motion';

/** Space between a dot and its name (CSS px). */
export const LABEL_GAP_PX = 6;
/** Height of a name's box: 12 px text plus its halo stroke. */
export const LABEL_HEIGHT_PX = 16;
/** Names keep this far from the canvas edge. */
export const LABEL_EDGE_PX = 4;
/** Most names one frame places (highlighted plus quiet ones). */
export const MAX_PLACED_LABELS = MAX_LABELS + 60;
/** Two drifting names stay apart: each dot sways up to the drift amplitude. */
const LABEL_SPACING_PX = 2 * DRIFT_AMPLITUDE_PX;
/** Text height inside a name's box: what must not cover a dot. */
const TEXT_INSET_PX = 2;
/** An always-shown name is shortened rather than squeezed into less room than this. */
const MIN_LABEL_ROOM_PX = 48;
const ELLIPSIS = '…';

/**
 * `forced`: hover, selection, a local graph's note (always drawn); `lit`: neighbours of the
 * selection; `hub`: a quiet name of one of the biggest hubs; `quiet`: any other quiet name.
 */
export type LabelKind = 'forced' | 'lit' | 'hub' | 'quiet';

export const PLACED = 1;
export const BLOCKED = 0;
/** Off the canvas, or too small a dot for this kind of name. */
export const HIDDEN = -1;

// Boxes (x, top, width) of the names placed in the current frame, reused frame to frame.
const boxes = new Float32Array(MAX_PLACED_LABELS * 3);
let boxCount = 0;

export function resetPlacedLabels(): void {
  boxCount = 0;
}

/** Width of node `i`'s name in the label font (`ctx.font` must be set), measured once. */
export function labelWidth(ctx: CanvasRenderingContext2D, f: FrameInput, i: number): number {
  const known = f.labelWidths[i] ?? Number.NaN;
  if (!Number.isNaN(known)) return known;
  const width = ctx.measureText(f.model.nodes[i]?.title ?? '').width;
  f.labelWidths[i] = width;
  return width;
}

function overlapsPlaced(x: number, top: number, width: number): boolean {
  const height = LABEL_HEIGHT_PX + LABEL_SPACING_PX;
  for (let b = 0; b < boxCount; b++) {
    const bx = boxes[b * 3] ?? 0;
    const by = boxes[b * 3 + 1] ?? 0;
    const bw = boxes[b * 3 + 2] ?? 0;
    const apartX = x >= bx + bw + LABEL_SPACING_PX || x + width + LABEL_SPACING_PX <= bx;
    const apartY = top >= by + height || top + height <= by;
    if (!apartX && !apartY) return true;
  }
  return false;
}

function overlapsExcluded(f: FrameInput, x: number, top: number, width: number): boolean {
  for (const rect of f.labelExclusions) {
    const apartX = x >= rect.x + rect.width || x + width <= rect.x;
    const apartY = top >= rect.y + rect.height || top + LABEL_HEIGHT_PX <= rect.y;
    if (!apartX && !apartY) return true;
  }
  return false;
}

/** Whether a `kind` name may stand at (x, top); `clean` also keeps quiet names off dots. */
function free(
  f: FrameInput,
  kind: LabelKind,
  i: number,
  x: number,
  top: number,
  w: number,
  clean: boolean,
) {
  if (overlapsPlaced(x, top, w)) return false;
  if (kind === 'forced') return true;
  if (overlapsExcluded(f, x, top, w)) return false;
  if (!clean || kind === 'lit') return true;
  return !coversDot(x, top + TEXT_INSET_PX, w, LABEL_HEIGHT_PX - 2 * TEXT_INSET_PX, i);
}

/** The longest start of `text` that, with "…", is at most `room` wide. Rare path: allocates. */
function shorten(ctx: CanvasRenderingContext2D, text: string, room: number): string {
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(chars.slice(0, mid).join('') + ELLIPSIS).width <= room) low = mid;
    else high = mid - 1;
  }
  return chars.slice(0, low).join('').trimEnd() + ELLIPSIS;
}

/**
 * Places and draws node `i`'s name in the current fill style: `PLACED`, `BLOCKED` (no free spot)
 * or `HIDDEN`. `minRadiusPx` > 0 hides dots smaller than that on screen.
 */
export function placeLabel(
  ctx: CanvasRenderingContext2D,
  f: FrameInput,
  i: number,
  kind: LabelKind,
  minRadiusPx = 0,
): number {
  const { model, view, width, height } = f;
  const node = model.nodes[i];
  if (!node) return HIDDEN;
  const r = (f.radius[i] ?? 0) * view.scale;
  if (r < minRadiusPx) return HIDDEN;
  // Decide at the resting place, draw where the dot is now (intro and drift move it).
  const bx = (node.x ?? 0) * view.scale + view.tx;
  const by = (node.y ?? 0) * view.scale + view.ty;
  const sx = (f.px[i] ?? 0) * view.scale + view.tx;
  const sy = (f.py[i] ?? 0) * view.scale + view.ty;
  if (sy < 0 || sy > height || sx + r < 0 || sx - r > width) return HIDDEN;
  const top = by - LABEL_HEIGHT_PX / 2;
  const maxRight = width - LABEL_EDGE_PX;
  const w = labelWidth(ctx, f, i);
  const right = bx + r + LABEL_GAP_PX;
  const left = bx - r - LABEL_GAP_PX - w;
  const fitsRight = right + w <= maxRight;
  const fitsLeft = left >= LABEL_EDGE_PX;
  let text = node.title;
  let x: number;
  let shown = w;
  if (fitsRight && free(f, kind, i, right, top, w, true)) x = right;
  else if (fitsLeft && free(f, kind, i, left, top, w, true)) x = left;
  else if (kind === 'hub' && fitsRight && free(f, kind, i, right, top, w, false)) x = right;
  else if (kind === 'hub' && fitsLeft && free(f, kind, i, left, top, w, false)) x = left;
  else if (kind !== 'forced') return BLOCKED;
  else if (fitsRight || fitsLeft) x = fitsRight ? right : left;
  else {
    // Always shown but too long for either side: shorten it on the roomier side.
    const roomRight = maxRight - right;
    const roomLeft = bx - r - LABEL_GAP_PX - LABEL_EDGE_PX;
    const room = Math.max(roomRight, roomLeft);
    const full = maxRight - LABEL_EDGE_PX;
    text = shorten(ctx, node.title, room >= MIN_LABEL_ROOM_PX ? room : full);
    shown = ctx.measureText(text).width;
    if (room < MIN_LABEL_ROOM_PX) x = Math.min(Math.max(right, LABEL_EDGE_PX), maxRight - shown);
    else x = roomRight >= roomLeft ? right : bx - r - LABEL_GAP_PX - shown;
  }
  ctx.strokeText(text, x + sx - bx, sy);
  ctx.fillText(text, x + sx - bx, sy);
  if (boxCount < MAX_PLACED_LABELS) {
    boxes[boxCount * 3] = x;
    boxes[boxCount * 3 + 1] = top;
    boxes[boxCount * 3 + 2] = shown;
    boxCount++;
  }
  f.labelMark[i] = f.labelPass;
  return PLACED;
}
