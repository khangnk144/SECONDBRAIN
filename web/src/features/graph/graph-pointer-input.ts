/**
 * Pointer and wheel input of a graph canvas (CSS px relative to the canvas): hover, click,
 * double-click, pan, node drag and wheel zoom around the pointer. The local graph only hovers.
 */
import { PointerGesture } from './graph-pointer-gesture';
import type { GraphScene } from './graph-scene';
import * as vp from './graph-viewport';

export interface PointerInputHost {
  readonly scene: GraphScene | null;
  readonly viewport: vp.Viewport;
  readonly options: {
    readonly mode: 'full' | 'local';
    onNodeClick?: (id: string) => void;
    onBackgroundClick?: () => void;
    onNodeOpen?: (id: string) => void;
  };
  hitAt: (x: number, y: number) => number;
  setHover: (index: number) => void;
  requestFrame: () => void;
}

export class GraphPointerInput {
  private readonly gesture = new PointerGesture();
  private dragged = -1;

  constructor(private readonly host: PointerInputHost) {}

  /** A new scene replaces the nodes a press may refer to. */
  reset(): void {
    this.gesture.cancel();
    this.dragged = -1;
  }

  pointerDown(x: number, y: number): void {
    this.gesture.down(x, y, this.host.hitAt(x, y));
  }

  pointerMove(x: number, y: number): void {
    const { host } = this;
    const scene = host.scene;
    const event = this.gesture.move(x, y);
    if (!scene) return;
    if (!event) {
      if (!this.gesture.pressed) host.setHover(host.hitAt(x, y));
      return;
    }
    if (host.options.mode === 'local') return;
    if (event.type === 'pan') vp.panBy(host.viewport, event.dx, event.dy);
    else if (event.type === 'drag-node') {
      const node = scene.model.nodes[event.index];
      if (!node) return;
      // Pinned while dragged, so a layout still settling does not pull it back.
      node.x = node.fx = vp.toWorldX(host.viewport, x);
      node.y = node.fy = vp.toWorldY(host.viewport, y);
      this.dragged = event.index;
      scene.markMoved();
    }
    host.requestFrame();
  }

  pointerUp(x: number, y: number, time: number): void {
    const { host } = this;
    const scene = host.scene;
    const dragged = scene?.model.nodes[this.dragged];
    if (dragged) dragged.fx = dragged.fy = null;
    this.dragged = -1;
    const events = this.gesture.up(x, y, time);
    if (!scene || host.options.mode === 'local') return;
    for (const event of events) {
      if (event.type !== 'click' && event.type !== 'double-click') continue;
      const id = scene.model.nodes[event.index]?.id;
      if (event.type === 'double-click') {
        if (id !== undefined) host.options.onNodeOpen?.(id);
      } else if (id !== undefined) host.options.onNodeClick?.(id);
      else host.options.onBackgroundClick?.();
    }
  }

  pointerLeave(): void {
    if (!this.gesture.pressed) this.host.setHover(-1);
  }

  pointerCancel(): void {
    this.gesture.cancel();
  }

  /** Returns false when the wheel is not used (local graph), so the page may scroll. */
  wheel(x: number, y: number, deltaY: number, deltaMode: number): boolean {
    if (this.host.options.mode === 'local') return false;
    vp.zoomAt(this.host.viewport, vp.wheelZoomFactor(deltaY, deltaMode), x, y);
    this.host.requestFrame();
    return true;
  }
}
