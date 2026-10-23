/**
 * F35.8, design.md §12.6: Bento Today's one moment of motion, on its first paint with data in this
 * page load – the strip bars appear left → right (400 ms, strip-intro.ts), and at the same time
 * the progress rings run to their percentage and the writing bars grow (≤ 600 ms, ease-out).
 * Coming back to Today, later data refreshes and reduced motion show the final state at once.
 */
import { useEffect, useLayoutEffect, useState } from 'react';
import { prefersReducedMotion } from '../use-media-query';

export type BentoIntroPart = 'rings' | 'bars';

/** Longest intro animation (600 ms) plus a margin; then the class goes. */
const INTRO_MS = 700;

const played = new Set<BentoIntroPart>();

/** True exactly once per page load for each part (never under reduced motion). */
export function claimBentoIntro(part: BentoIntroPart): boolean {
  if (played.has(part)) return false;
  played.add(part);
  return !prefersReducedMotion();
}

/** Tests: start as a freshly opened app. */
export function resetBentoIntro(): void {
  played.clear();
}

/**
 * Whether `part` plays its intro now: claimed before the first paint with data (`ready`), so
 * nothing flashes in its final state first, and dropped once it ran, so rings or bars added later
 * never animate.
 */
export function useBentoIntro(part: BentoIntroPart, ready: boolean): boolean {
  const [intro, setIntro] = useState(false);
  useLayoutEffect(() => {
    if (ready && claimBentoIntro(part)) setIntro(true);
  }, [part, ready]);
  useEffect(() => {
    if (!intro) return;
    const timer = window.setTimeout(() => setIntro(false), INTRO_MS);
    return () => window.clearTimeout(timer);
  }, [intro]);
  return intro;
}
