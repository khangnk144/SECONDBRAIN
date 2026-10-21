/**
 * Service worker source. `vite-plugin-service-worker.ts` bundles it into `dist/sw.js` at the end
 * of `vite build` and defines the two constants below. It caches the UI shell only: API calls,
 * the WebSocket and every other path go straight to the server, never through a cache.
 */
import { cacheNameFor, classifyRequest, SHELL_CACHE_KEY } from './service-worker-routes';
import {
  deleteStaleCaches,
  handleNavigation,
  handlePrecached,
  installBuild,
  type ShellStore,
} from './service-worker-strategies';

/** Content hash of the build; a new build gives a new worker, cache and update toast. */
declare const __SB_BUILD_ID__: string;
/** Absolute paths of every built asset and public file (no index.html, no sw.js). */
declare const __SB_PRECACHE__: string[];

// The web tsconfig uses the DOM library (the worker library conflicts with it), so the few
// worker globals used here are typed by hand.
interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEventLike extends ExtendableEventLike {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
interface MessageEventLike extends ExtendableEventLike {
  data: unknown;
}
interface WorkerScope {
  location: Location;
  caches: CacheStorage;
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (e: ExtendableEventLike) => void): void;
  addEventListener(type: 'fetch', listener: (e: FetchEventLike) => void): void;
  addEventListener(type: 'message', listener: (e: MessageEventLike) => void): void;
}

const worker = self as unknown as WorkerScope;
const CACHE = cacheNameFor(__SB_BUILD_ID__);
const ORIGIN = worker.location.origin;
const SHELL_URL = new URL(SHELL_CACHE_KEY, ORIGIN).href;
const PRECACHE_URLS = __SB_PRECACHE__.map((pathName) => new URL(pathName, ORIGIN).href);
const PRECACHE_PATHS = new Set(__SB_PRECACHE__);

const store: ShellStore = {
  fetch: (request) => fetch(request),
  readShell: async () => (await worker.caches.open(CACHE)).match(SHELL_URL),
  storeShell: async (response) => (await worker.caches.open(CACHE)).put(SHELL_URL, response),
  matchCached: (request) => worker.caches.match(request),
};

worker.addEventListener('install', (event) => {
  event.waitUntil(
    worker.caches
      .open(CACHE)
      .then((cache) => installBuild(cache, PRECACHE_URLS, SHELL_URL, (request) => fetch(request))),
  );
  // No skipWaiting here: an update waits until the page's "Tải lại" toast asks for it.
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(deleteStaleCaches(worker.caches, CACHE).then(() => worker.clients.claim()));
});

worker.addEventListener('message', (event) => {
  const data = event.data as { type?: unknown } | null;
  if (data && data.type === 'SKIP_WAITING') event.waitUntil(worker.skipWaiting());
});

worker.addEventListener('fetch', (event) => {
  const { request } = event;
  const route = classifyRequest(request, ORIGIN, PRECACHE_PATHS);
  if (route === 'navigation') {
    const { response, stored } = handleNavigation(request, store);
    event.respondWith(response);
    event.waitUntil(stored);
  } else if (route === 'precache') {
    event.respondWith(handlePrecached(request, store));
  }
  // passthrough: no respondWith, the browser handles the request as if there were no worker.
});
