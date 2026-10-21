/**
 * Routing decisions of the service worker, kept free of worker globals so they can be unit
 * tested. The worker caches the UI shell only: API calls, the WebSocket and every path that is
 * not part of the built shell always go to the network untouched.
 */

/** Every cache this app creates starts with this prefix (old ones are deleted on activate). */
export const CACHE_PREFIX = 'sb-shell-';

/** Cache key of the last good UI shell (any navigation is answered with the same shell). */
export const SHELL_CACHE_KEY = '/';

/** How long a navigation waits for the server before the cached shell is shown. */
export const NAVIGATION_TIMEOUT_MS = 4_000;

export type RequestRoute = 'navigation' | 'precache' | 'passthrough';

export interface RequestFacts {
  method: string;
  /** `Request.mode`; `navigate` for page loads. */
  mode: string;
  url: string;
}

export function cacheNameFor(buildId: string): string {
  return `${CACHE_PREFIX}${buildId}`;
}

/** Caches left by earlier builds (anything with our prefix except the current one). */
export function staleCacheNames(names: readonly string[], current: string): string[] {
  return names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== current);
}

function isApiOrSocketPath(pathname: string): boolean {
  return (
    pathname === '/api' || pathname.startsWith('/api/') || pathname === '/ws' || pathname === '/ws/'
  );
}

/**
 * - `navigation`: a same-origin page load outside /api and /ws → network first, cached shell
 *   when the server cannot be reached.
 * - `precache`: a built asset or public file of the shell (no query string) → cache first.
 * - `passthrough`: everything else; the worker does not call respondWith at all.
 */
export function classifyRequest(
  request: RequestFacts,
  origin: string,
  precachePaths: ReadonlySet<string>,
): RequestRoute {
  if (request.method !== 'GET') return 'passthrough';
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return 'passthrough';
  }
  if (url.origin !== origin || isApiOrSocketPath(url.pathname)) return 'passthrough';
  if (request.mode === 'navigate') return 'navigation';
  if (url.search !== '') return 'passthrough';
  if (precachePaths.has(url.pathname) || url.pathname.startsWith('/assets/')) return 'precache';
  return 'passthrough';
}

export interface ResponseFacts {
  status: number;
  /** `Response.type`: `basic` for same-origin responses. */
  type: string;
  redirected: boolean;
  contentType: string | null;
}

/** Only a complete, same-origin HTML page of status 200 may replace the cached shell. */
export function isCacheableShellResponse(response: ResponseFacts): boolean {
  return (
    response.status === 200 &&
    response.type === 'basic' &&
    !response.redirected &&
    (response.contentType ?? '').toLowerCase().startsWith('text/html')
  );
}

/** Resolves like `promise`, or rejects with `TimeoutError` after `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => {
      const error = new Error('Timed out.');
      error.name = 'TimeoutError';
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(id);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(id);
        reject(error);
      },
    );
  });
}
