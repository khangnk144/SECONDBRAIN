/**
 * Timing of the graph's motion (design.md §4 screen 6, §6): the 600 ms intro from the center,
 * the 300 ms signal along edges, and the slow drift once the layout has settled. Under
 * `prefers-reduced-motion` none of these run; highlights switch instantly.
 */
import { useEffect, useState } from 'react';

export const INTRO_MS = 600;
export const SIGNAL_MS = 300;
/** Drift: each dot sways at most this far (screen px) around its place … */
export const DRIFT_AMPLITUDE_PX = 3;
/** … over this period, so it moves ≈ 0.05 px per 60 Hz frame. */
export const DRIFT_PERIOD_MS = 6_000;
/** A slow or late frame advances the drift clock by at most this much, so nothing jumps. */
export const MAX_DRIFT_STEP_MS = 50;
/** SPEC F16: drift stays ≤ 0.3 px per frame. */
export const MAX_DRIFT_PX_PER_FRAME = 0.3;

const TWO_PI = Math.PI * 2;
/** The y sway uses another period, so dots trace slow loops instead of lines. */
const DRIFT_Y_PERIOD_RATIO = 1.37;

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/** Intro: how far (0 → 1) nodes have expanded from the center after `elapsedMs`. */
export function introProgress(elapsedMs: number): number {
  return easeOutCubic(elapsedMs / INTRO_MS);
}

/** Per-node phase, spread by the golden angle so neighbours never sway in step. */
export function driftPhase(index: number): number {
  return (index * 2.399963229728653) % TWO_PI;
}

export function driftOffsetX(clockMs: number, phase: number): number {
  return DRIFT_AMPLITUDE_PX * Math.sin((TWO_PI * clockMs) / DRIFT_PERIOD_MS + phase);
}

export function driftOffsetY(clockMs: number, phase: number): number {
  const period = DRIFT_PERIOD_MS * DRIFT_Y_PERIOD_RATIO;
  return DRIFT_AMPLITUDE_PX * Math.sin((TWO_PI * clockMs) / period + phase * 1.7);
}

/** Advances the drift clock by one frame's time, capped so a stalled tab never jumps. */
export function nextDriftClock(clockMs: number, frameMs: number): number {
  return clockMs + Math.min(Math.max(0, frameMs), MAX_DRIFT_STEP_MS);
}

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(win: Window = window): boolean {
  return typeof win.matchMedia === 'function' && win.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Follows the OS "reduce motion" setting while mounted. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion());
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}
