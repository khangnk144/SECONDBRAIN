import type { UIMatch } from 'react-router';
import type { AppRouteHandle } from './routes';

/** Handles of the matched routes merged from outer to inner (the deepest route wins). */
export function mergedRouteHandle(matches: UIMatch[]): AppRouteHandle {
  const merged: AppRouteHandle = {};
  for (const match of matches) Object.assign(merged, match.handle as AppRouteHandle | undefined);
  return merged;
}
