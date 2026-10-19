/**
 * Lets stores and operations navigate without a React hook: the layout registers the router's
 * `navigate` once. Routes are hash routes (`#/note?path=…`).
 */
import type { VaultPath } from './api/vault-types';
import { withQuery } from './api/query-string';

export type Navigator = (to: string, options?: { replace?: boolean }) => void;

let current: Navigator | null = null;

/** Returns a function that unregisters this navigator (if still the current one). */
export function setAppNavigator(navigate: Navigator): () => void {
  current = navigate;
  return () => {
    if (current === navigate) current = null;
  };
}

export function navigateTo(to: string, options?: { replace?: boolean }): void {
  current?.(to, options);
}

export const TODAY_ROUTE = '/';
export const NOTE_ROUTE = '/note';
export const TAGS_ROUTE = '/tags';

/** `/note?path=<encoded>`; `isNew` adds `&new=1` so the note screen selects the title. */
export function noteRoute(path: VaultPath, options: { isNew?: boolean } = {}): string {
  return withQuery(NOTE_ROUTE, { path, new: options.isNew ? '1' : undefined });
}
