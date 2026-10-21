/**
 * design.md §6: the strip's line draws left → right once when the app opens (400 ms), and the
 * overdue dot blinks its border once with it. Coming back to Today later does not replay it, and
 * nothing moves when the user prefers reduced motion.
 */
import { prefersReducedMotion } from './use-media-query';

let played = false;

/** True exactly once per page load (and never under reduced motion). */
export function claimStripIntro(): boolean {
  if (played) return false;
  played = true;
  return !prefersReducedMotion();
}

/** Tests: start as a freshly opened app. */
export function resetStripIntro(): void {
  played = false;
}
