/**
 * Pure geometry and timing of "AI vừa chạm" on the canvas: where a source enters (the canvas edge
 * nearest its place, or nearest the pages it touched when it is not on the map) and, for one
 * output at a given moment, how far its signal has travelled and how bright its halo is.
 */
import { AI_TOUCH_HOLD_MS, AI_TOUCH_TRAVEL_MS } from './graph-ai-touch';
import type { LabelRect } from './graph-draw';
import type { CanvasSize, GraphScene } from './graph-scene';
import type { Viewport } from './graph-viewport';

/** The source settles this far inside the canvas edge (CSS px). */
export const EDGE_INSET_PX = 16;
/** A lit output's halo fades in and, at the end of its 10 s, out (motion only). */
const HALO_FADE_IN_MS = 150;
const HALO_FADE_OUT_MS = 400;

/** Point on the canvas edge nearest to (x, y), `EDGE_INSET_PX` inside (screen px). */
export function nearestEdgePoint(x: number, y: number, size: { width: number; height: number }) {
  const { width, height } = size;
  const inset = Math.min(EDGE_INSET_PX, width / 2, height / 2);
  const cx = Math.min(Math.max(x, inset), width - inset);
  const cy = Math.min(Math.max(y, inset), height - inset);
  const left = cx;
  const right = width - cx;
  const top = cy;
  const bottom = height - cy;
  const nearest = Math.min(left, right, top, bottom);
  if (nearest === left) return { x: inset, y: cy };
  if (nearest === right) return { x: width - inset, y: cy };
  if (nearest === top) return { x: cx, y: inset };
  return { x: cx, y: height - inset };
}

/** Room kept between a source's dot (and its name's line) and an overlay (CSS px). */
export const OVERLAY_CLEARANCE_PX = 12;

const overlaps = (x: number, y: number, r: LabelRect, c: number) =>
  x + c > r.x && x - c < r.x + r.width && y + c > r.y && y - c < r.y + r.height;

/**
 * Moves a point at the canvas edge off the overlays drawn over the canvas (the legend row, the
 * zoom controls), which names already keep off: out of the overlay it falls in, on its nearest
 * side that stays inside the canvas. Screen px.
 */
export function clearOfOverlays(
  point: { x: number; y: number },
  size: { width: number; height: number },
  overlays: readonly LabelRect[],
): { x: number; y: number } {
  const inset = Math.min(EDGE_INSET_PX, size.width / 2, size.height / 2);
  const c = OVERLAY_CLEARANCE_PX;
  let { x, y } = point;
  // Bounded: two overlays side by side can push a point back and forth.
  for (let pass = 0; pass <= overlays.length; pass++) {
    const hit = overlays.find((rect) => overlaps(x, y, rect, c));
    if (!hit) break;
    const best = [
      { x, y: hit.y - c },
      { x, y: hit.y + hit.height + c },
      { x: hit.x - c, y },
      { x: hit.x + hit.width + c, y },
    ]
      .filter((p) => p.x >= inset && p.x <= size.width - inset)
      .filter((p) => p.y >= inset && p.y <= size.height - inset)
      .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (!best) break;
    ({ x, y } = best);
  }
  return { x, y };
}

export interface SourceEntry {
  /** Drawn as its own hollow dot at the edge (not on the map, or off screen). */
  ghost: boolean;
  /** Entry point in world units. */
  x: number;
  y: number;
}

/**
 * Where the source of a playback enters, from the view of its first frame: the canvas edge point
 * nearest its place on the map; a source that is not on the map enters on the side of the pages
 * it touched (their centre), one that is off screen stays at the edge as its own dot. The point
 * keeps clear of the canvas overlays (`overlays`, screen px), like the names do.
 */
export function sourceEntry(
  scene: GraphScene,
  view: Viewport,
  size: CanvasSize,
  sourceIndex: number,
  outputs: Int32Array,
  overlays: readonly LabelRect[] = [],
): SourceEntry {
  const screen = (i: number) => ({
    x: (scene.px[i] ?? 0) * view.scale + view.tx,
    y: (scene.py[i] ?? 0) * view.scale + view.ty,
  });
  let reference = sourceIndex >= 0 ? screen(sourceIndex) : null;
  const ghost =
    reference === null ||
    reference.x < 0 ||
    reference.y < 0 ||
    reference.x > size.width ||
    reference.y > size.height;
  if (reference === null) {
    const points = Array.from(outputs)
      .filter((i) => i >= 0)
      .map(screen);
    reference =
      points.length === 0
        ? { x: size.width, y: size.height / 2 }
        : {
            x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
            y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
          };
  }
  const edge = clearOfOverlays(nearestEdgePoint(reference.x, reference.y, size), size, overlays);
  return { ghost, x: (edge.x - view.tx) / view.scale, y: (edge.y - view.ty) / view.scale };
}

/**
 * One output at wall time `wall`, lit at `at`: the signal's progress (0 → 1 during the travel
 * before `at`, -1 otherwise; never under reduced motion), whether it is lit (`at` ≤ wall <
 * `at` + 10 s) and its halo's opacity (fading in and out with motion).
 */
export function outputStateAt(at: number, wall: number, motion: boolean) {
  const departs = at - AI_TOUCH_TRAVEL_MS;
  const signal =
    motion && wall >= departs && wall < at ? (wall - departs) / AI_TOUCH_TRAVEL_MS : -1;
  const lit = wall >= at && wall < at + AI_TOUCH_HOLD_MS;
  if (!lit) return { signal, lit, halo: 0 };
  const halo = motion
    ? Math.min(1, (wall - at) / HALO_FADE_IN_MS, (at + AI_TOUCH_HOLD_MS - wall) / HALO_FADE_OUT_MS)
    : 1;
  return { signal, lit, halo };
}
