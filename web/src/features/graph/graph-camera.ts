/**
 * Viewport plus canvas size. "Fit the graph" and "center on this node" are requests that wait
 * until both a scene and a non-zero canvas size exist (the canvas is measured after mounting).
 */
import { fitViewportWithLabels, type FitLabel } from './graph-label-fit';
import type { GraphModel } from './graph-model';
import type { CanvasSize } from './graph-scene';
import * as vp from './graph-viewport';

export class GraphCamera {
  readonly viewport = vp.createViewport();
  readonly size: CanvasSize = { width: 0, height: 0, dpr: 1 };
  private needsFit = true;
  private pendingCenter: string | null = null;

  get hasSize(): boolean {
    return this.size.width > 0 && this.size.height > 0;
  }

  /** Returns false when nothing changed; keeps the middle of the picture in the middle. */
  resize(width: number, height: number, dpr: number): boolean {
    const size = this.size;
    if (width === size.width && height === size.height && dpr === size.dpr) return false;
    if (size.width > 0 && width > 0) {
      vp.panBy(this.viewport, (width - size.width) / 2, (height - size.height) / 2);
    }
    size.width = width;
    size.height = height;
    size.dpr = dpr;
    return true;
  }

  requestFit(): void {
    this.needsFit = true;
  }

  requestCenter(id: string): void {
    this.pendingCenter = id;
  }

  /**
   * Applies the pending fit and center once there is something to show and room to show it.
   * `fitLabels` (read only when a fit is due) are labels the fit keeps inside the canvas.
   */
  apply(model: GraphModel | null, fitLabels: () => readonly FitLabel[] = () => []): void {
    if (!model || !this.hasSize) return;
    const { width, height } = this.size;
    if (this.needsFit) {
      const bounds = vp.boundsOf(model.nodes);
      fitViewportWithLabels(this.viewport, bounds, width, height, fitLabels());
      this.needsFit = false;
    }
    if (this.pendingCenter !== null) {
      const node = model.nodes[model.indexById.get(this.pendingCenter) ?? -1];
      if (node) vp.centerOn(this.viewport, node.x ?? 0, node.y ?? 0, width, height);
      this.pendingCenter = null;
    }
  }

  /** Zoom around the middle of the canvas (keys and buttons). */
  zoomCenter(factor: number): void {
    vp.zoomAt(this.viewport, factor, this.size.width / 2, this.size.height / 2);
  }
}
