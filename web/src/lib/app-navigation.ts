/**
 * Lets stores and operations navigate without a React hook: the layout registers the router's
 * `navigate` once. Routes are hash routes (`#/note?path=…`).
 */
import type { VaultPath } from './api/vault-types';
import { withQuery } from './api/query-string';

export type Navigator = (to: string, options?: { replace?: boolean }) => void;

/** Where the router is now (it updates synchronously when a navigation starts). */
export interface CurrentRoute {
  pathname: string;
  search: string;
}

let current: Navigator | null = null;
let readRoute: (() => CurrentRoute) | null = null;

/** Returns a function that unregisters this navigator (if still the current one). */
export function setAppNavigator(navigate: Navigator): () => void {
  current = navigate;
  return () => {
    if (current === navigate) current = null;
  };
}

/** The app registers how to read the router's live location. Returns an unregister function. */
export function setRouteReader(reader: () => CurrentRoute): () => void {
  readRoute = reader;
  return () => {
    if (readRoute === reader) readRoute = null;
  };
}

/**
 * The route the router shows (or is going to) right now, read live, not from the last render: a
 * navigation that started a moment ago is already there. Null when no router registered (tests).
 */
export function currentRoute(): CurrentRoute | null {
  return readRoute ? readRoute() : null;
}

export function navigateTo(to: string, options?: { replace?: boolean }): void {
  current?.(to, options);
}

export const TODAY_ROUTE = '/';
export const NOTE_ROUTE = '/note';
export const TAGS_ROUTE = '/tags';
export const TASKS_ROUTE = '/tasks';
export const CALENDAR_ROUTE = '/calendar';
export const GRAPH_ROUTE = '/graph';

export interface NoteRouteOptions {
  /** Freshly created note: `&new=1`, the note screen selects the title. */
  isNew?: boolean;
  /**
   * UTF-16 offset in the file where the caret goes (`&cursor=N`, from a template's `{{cursor}}`);
   * the note screen consumes it. Null/undefined adds nothing.
   */
  cursor?: number | null;
}

/** `/note?path=<encoded>[&new=1][&cursor=N]`. */
export function noteRoute(path: VaultPath, options: NoteRouteOptions = {}): string {
  const cursor =
    typeof options.cursor === 'number' && Number.isInteger(options.cursor) && options.cursor >= 0
      ? options.cursor
      : undefined;
  return withQuery(NOTE_ROUTE, { path, new: options.isNew ? '1' : undefined, cursor });
}
