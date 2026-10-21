/**
 * Frames per second of the graph's animation loop, reported once per second (`?debug=fps`):
 * the screen shows it in an overlay with `data-graph-fps` and logs it to the console, so a
 * headless browser run can read it.
 */
const WINDOW_MS = 1_000;

export class FpsMeter {
  private windowStart = -1;
  private frames = 0;

  constructor(private readonly report: (fps: number) => void) {}

  frame(now: number): void {
    if (this.windowStart < 0) {
      this.windowStart = now;
      this.frames = 0;
      return;
    }
    this.frames++;
    const elapsed = now - this.windowStart;
    if (elapsed >= WINDOW_MS) {
      this.report(Math.round((this.frames * 1000) / elapsed));
      this.windowStart = now;
      this.frames = 0;
    }
  }

  /** After a pause (hidden tab) the next frame starts a fresh window. */
  reset(): void {
    this.windowStart = -1;
  }
}
