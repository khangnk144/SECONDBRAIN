/**
 * Frame timing of the full map: intro and signal start with the first frame after they are
 * requested (frame timestamps are the only clock, so tests can drive it with plain numbers), and
 * the drift clock advances by capped frame steps so a hidden or stalled tab never makes a jump.
 */
import { INTRO_MS, SIGNAL_MS, introProgress, nextDriftClock } from './graph-motion';

const IDLE = -1;
const NEXT_FRAME = -2;

export interface FrameScheduler {
  request: (callback: (now: number) => void) => number;
  cancel: (handle: number) => void;
}

export const browserFrameScheduler: FrameScheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
};

export class GraphMotionClock {
  /** Intro expansion of this frame, 0 → 1 (1 when no intro runs). */
  intro = 1;
  /** Signal position along its edges this frame, 0 → 1, or -1 when idle. */
  signal = -1;
  /** True on the frame where the signal reached its targets. */
  signalArrived = false;
  driftClock = 0;
  private introStart = IDLE;
  private signalStart = IDLE;
  private lastFrame = -1;

  get running(): boolean {
    return this.introStart !== IDLE || this.signalStart !== IDLE;
  }

  get introRunning(): boolean {
    return this.introStart !== IDLE;
  }

  get signalRunning(): boolean {
    return this.signalStart !== IDLE;
  }

  startIntro(): void {
    this.introStart = NEXT_FRAME;
  }

  startSignal(): void {
    this.signalStart = NEXT_FRAME;
  }

  stopIntro(): void {
    this.introStart = IDLE;
    this.intro = 1;
  }

  stopSignal(): void {
    this.signalStart = IDLE;
    this.signal = -1;
  }

  /** The next frame starts a fresh step (after a hidden tab). */
  resetFrameTime(): void {
    this.lastFrame = -1;
  }

  /** Advances to the frame at `now`; `drift` says whether the drift clock moves. */
  advance(now: number, drift: boolean): void {
    const elapsed = this.lastFrame < 0 ? 0 : now - this.lastFrame;
    this.lastFrame = now;
    if (this.introStart === NEXT_FRAME) this.introStart = now;
    if (this.signalStart === NEXT_FRAME) this.signalStart = now;
    this.intro = 1;
    if (this.introStart !== IDLE) {
      this.intro = introProgress(now - this.introStart);
      if (now - this.introStart >= INTRO_MS) this.introStart = IDLE;
    }
    this.signal = -1;
    this.signalArrived = false;
    if (this.signalStart !== IDLE) {
      const progress = (now - this.signalStart) / SIGNAL_MS;
      if (progress >= 1) {
        this.signalStart = IDLE;
        this.signalArrived = true;
      } else this.signal = progress;
    }
    if (drift) this.driftClock = nextDriftClock(this.driftClock, elapsed);
  }
}
