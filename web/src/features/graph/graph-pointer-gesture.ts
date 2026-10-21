/**
 * Turns pointer down/move/up into graph gestures: a press that does not travel is a click (two
 * on the same node in quick succession also make a double-click), a press that travels pans the
 * view, or moves the node it started on. Pointer events only, so mouse, pen and touch behave alike.
 */
export const DRAG_THRESHOLD_PX = 4;
export const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_DISTANCE_PX = 8;

export type GestureEvent =
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'drag-node'; index: number; x: number; y: number }
  | { type: 'click'; index: number }
  | { type: 'double-click'; index: number };

interface Press {
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  index: number;
  moved: boolean;
}

export class PointerGesture {
  private press: Press | null = null;
  private lastClick: { index: number; x: number; y: number; time: number } | null = null;

  get pressed(): boolean {
    return this.press !== null;
  }

  /** `index` = node under the pointer or -1. */
  down(x: number, y: number, index: number): void {
    this.press = { x, y, lastX: x, lastY: y, index, moved: false };
  }

  /** Null while nothing is pressed (the caller then updates the hover). */
  move(x: number, y: number): GestureEvent | null {
    const press = this.press;
    if (!press) return null;
    if (!press.moved && Math.hypot(x - press.x, y - press.y) < DRAG_THRESHOLD_PX) return null;
    press.moved = true;
    const dx = x - press.lastX;
    const dy = y - press.lastY;
    press.lastX = x;
    press.lastY = y;
    return press.index >= 0
      ? { type: 'drag-node', index: press.index, x, y }
      : { type: 'pan', dx, dy };
  }

  up(x: number, y: number, time: number): GestureEvent[] {
    const press = this.press;
    this.press = null;
    if (!press || press.moved) return [];
    const events: GestureEvent[] = [{ type: 'click', index: press.index }];
    const last = this.lastClick;
    const isDouble =
      press.index >= 0 &&
      last !== null &&
      last.index === press.index &&
      time - last.time <= DOUBLE_CLICK_MS &&
      Math.hypot(x - last.x, y - last.y) <= DOUBLE_CLICK_DISTANCE_PX;
    if (isDouble) {
      events.push({ type: 'double-click', index: press.index });
      this.lastClick = null;
    } else this.lastClick = { index: press.index, x, y, time };
    return events;
  }

  cancel(): void {
    this.press = null;
  }
}
