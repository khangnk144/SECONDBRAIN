/**
 * Pan and zoom of the canvas: screen = world × scale + (tx, ty), in CSS pixels. Functions mutate
 * the viewport in place (pointer moves arrive at frame rate).
 */
import type { GraphModelNode } from './graph-model';

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;
/** `+` / `-` keys and the zoom buttons. */
export const KEY_ZOOM_FACTOR = 1.25;
/** The fitted view never magnifies a tiny graph beyond this. */
const MAX_FIT_SCALE = 2;
const FIT_PADDING_PX = 48;

export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
  /** Scale of the last fit to the canvas (default zoom); labels grow in number past it. */
  fitScale: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function createViewport(): Viewport {
  return { scale: 1, tx: 0, ty: 0, fitScale: 1 };
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Bounding box of the node positions (radius included); null without nodes. */
export function boundsOf(nodes: readonly GraphModelNode[]): Bounds | null {
  if (nodes.length === 0) return null;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const node of nodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    bounds.minX = Math.min(bounds.minX, x - node.radius);
    bounds.minY = Math.min(bounds.minY, y - node.radius);
    bounds.maxX = Math.max(bounds.maxX, x + node.radius);
    bounds.maxY = Math.max(bounds.maxY, y + node.radius);
  }
  return bounds;
}

/** Space the fitted view keeps between the dots and the canvas edge. */
export function fitPadding(width: number, height: number): number {
  return Math.min(FIT_PADDING_PX, width / 4, height / 4);
}

/** Scales and centers so the whole graph fits the canvas (the `0` key comes back here). */
export function fitViewport(view: Viewport, bounds: Bounds | null, width: number, height: number) {
  if (!bounds || width <= 0 || height <= 0) {
    view.scale = 1;
    view.tx = width / 2;
    view.ty = height / 2;
    view.fitScale = 1;
    return;
  }
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const padding = fitPadding(width, height);
  const scale = Math.min((width - 2 * padding) / w, (height - 2 * padding) / h);
  view.scale = clampScale(Math.min(MAX_FIT_SCALE, scale));
  view.tx = width / 2 - ((bounds.minX + bounds.maxX) / 2) * view.scale;
  view.ty = height / 2 - ((bounds.minY + bounds.maxY) / 2) * view.scale;
  view.fitScale = view.scale;
}

/** Zooms by `factor`, keeping the world point under (sx, sy) in place. */
export function zoomAt(view: Viewport, factor: number, sx: number, sy: number): void {
  const scale = clampScale(view.scale * factor);
  const k = scale / view.scale;
  view.tx = sx - (sx - view.tx) * k;
  view.ty = sy - (sy - view.ty) * k;
  view.scale = scale;
}

export function panBy(view: Viewport, dx: number, dy: number): void {
  view.tx += dx;
  view.ty += dy;
}

/** Moves the view so the world point (x, y) sits at the center of the canvas. */
export function centerOn(view: Viewport, x: number, y: number, width: number, height: number) {
  view.tx = width / 2 - x * view.scale;
  view.ty = height / 2 - y * view.scale;
}

export function toWorldX(view: Viewport, sx: number): number {
  return (sx - view.tx) / view.scale;
}

export function toWorldY(view: Viewport, sy: number): number {
  return (sy - view.ty) / view.scale;
}

/** Wheel delta (pixels or lines) to a zoom factor; one notch ≈ 15 %. */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-pixels * 0.0015);
}
