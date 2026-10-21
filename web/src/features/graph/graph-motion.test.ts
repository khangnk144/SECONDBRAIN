import { describe, expect, it } from 'vitest';
import {
  driftOffsetX,
  driftOffsetY,
  driftPhase,
  INTRO_MS,
  introProgress,
  MAX_DRIFT_PX_PER_FRAME,
  MAX_DRIFT_STEP_MS,
  nextDriftClock,
} from './graph-motion';

function largestStep(frameMs: number): number {
  let largest = 0;
  for (let index = 0; index < 50; index++) {
    const phase = driftPhase(index);
    let clock = 0;
    for (let frame = 0; frame < 2_000; frame++) {
      const next = nextDriftClock(clock, frameMs);
      const dx = driftOffsetX(next, phase) - driftOffsetX(clock, phase);
      const dy = driftOffsetY(next, phase) - driftOffsetY(clock, phase);
      largest = Math.max(largest, Math.hypot(dx, dy));
      clock = next;
    }
  }
  return largest;
}

describe('graph motion: drift and intro', () => {
  it('drifts at most 0.3 px per frame at 60 Hz, at 30 Hz and after a stalled frame', () => {
    expect(largestStep(1000 / 60)).toBeLessThanOrEqual(MAX_DRIFT_PX_PER_FRAME);
    expect(largestStep(1000 / 30)).toBeLessThanOrEqual(MAX_DRIFT_PX_PER_FRAME);
    expect(largestStep(5_000)).toBeLessThanOrEqual(MAX_DRIFT_PX_PER_FRAME);
    expect(largestStep(1000 / 60)).toBeGreaterThan(0);
  });

  it('caps the drift clock step so a hidden tab never jumps', () => {
    expect(nextDriftClock(100, 16)).toBe(116);
    expect(nextDriftClock(100, 60_000)).toBe(100 + MAX_DRIFT_STEP_MS);
    expect(nextDriftClock(100, -5)).toBe(100);
  });

  it('expands from the center over 600 ms, easing out', () => {
    expect(introProgress(0)).toBe(0);
    expect(introProgress(INTRO_MS / 2)).toBeGreaterThan(0.5);
    expect(introProgress(INTRO_MS)).toBe(1);
    expect(introProgress(INTRO_MS * 3)).toBe(1);
  });
});
