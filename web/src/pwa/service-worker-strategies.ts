/**
 * The caching strategies of the service worker, with the worker globals (fetch, Cache Storage)
 * passed in so the behaviour can be tested outside a worker.
 */
import {
  isCacheableShellResponse,
  NAVIGATION_TIMEOUT_MS,
  staleCacheNames,
  withTimeout,
} from './service-worker-routes';

export interface ShellStore {
  fetch: (request: Request) => Promise<Response>;
  /** The shell stored by the current build's cache, if any. */
  readShell: () => Promise<Response | undefined>;
  storeShell: (response: Response) => Promise<void>;
  /** Looks a request up in every cache of the origin (a waiting build's cache included). */
  matchCached: (request: Request) => Promise<Response | undefined>;
}

function cacheableShell(response: Response): boolean {
  return isCacheableShellResponse({
    status: response.status,
    type: response.type,
    redirected: response.redirected,
    contentType: response.headers.get('content-type'),
  });
}

export interface NavigationResult {
  /** What the page gets. */
  response: Promise<Response>;
  /** Settles once a fresh shell has been stored (keep the worker alive until then). */
  stored: Promise<void>;
}

/**
 * Network first: the server's page wins and becomes the cached shell. When the server cannot
 * be reached (or takes longer than the timeout) the cached shell is shown, so the app boots and
 * shows its own "not connected" banner instead of the browser's error page.
 */
export function handleNavigation(
  request: Request,
  store: ShellStore,
  timeoutMs = NAVIGATION_TIMEOUT_MS,
): NavigationResult {
  let storing: Promise<void> = Promise.resolve();
  // The copy is taken in the same callback that hands the response on, before the page can
  // start reading its body (a used body cannot be cloned).
  const network = store.fetch(request).then((response) => {
    if (cacheableShell(response)) storing = store.storeShell(response.clone());
    return response;
  });
  const stored = network.then(
    () => storing.catch(() => undefined),
    () => undefined,
  );
  const response = withTimeout(network, timeoutMs).catch(async () => {
    const cached = await store.readShell().catch(() => undefined);
    // No shell yet: keep waiting for the server (timeout) or let the browser show its error.
    return cached ?? network;
  });
  return { response, stored };
}

/** Cache first for the built assets; a miss goes to the network (and is not stored). */
export async function handlePrecached(request: Request, store: ShellStore): Promise<Response> {
  const cached = await store.matchCached(request).catch(() => undefined);
  return cached ?? store.fetch(request);
}

export interface InstallTarget {
  addAll: (requests: Request[]) => Promise<void>;
  put: (key: string, response: Response) => Promise<void>;
}

/**
 * Downloads every file of the build (bypassing the HTTP cache) and, best effort, the shell
 * itself, so the very first offline start works even if no page load went through the worker.
 */
export async function installBuild(
  target: InstallTarget,
  precacheUrls: readonly string[],
  shellUrl: string,
  fetchShell: (request: Request) => Promise<Response>,
): Promise<void> {
  await target.addAll(precacheUrls.map((url) => new Request(url, { cache: 'reload' })));
  try {
    const shell = await fetchShell(
      new Request(shellUrl, { cache: 'no-store', headers: { accept: 'text/html' } }),
    );
    if (cacheableShell(shell)) await target.put(shellUrl, shell);
  } catch {
    // Offline during install: the next page load stores the shell.
  }
}

/** Deletes the caches of earlier builds; returns their names. */
export async function deleteStaleCaches(
  caches: Pick<CacheStorage, 'keys' | 'delete'>,
  current: string,
): Promise<string[]> {
  const stale = staleCacheNames(await caches.keys(), current);
  await Promise.all(stale.map((name) => caches.delete(name)));
  return stale;
}
