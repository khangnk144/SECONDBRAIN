/**
 * Registers the shell service worker (production builds on the canonical origin only) and offers
 * a reload when a new build is waiting: toast "Có bản mới của app." with "Tải lại", which asks
 * the waiting worker to take over and reloads this window once it has.
 */
import { i18n } from '../i18n';
import { ACTION_TOAST_MS, showToast } from '../lib/toast-store';
import { useConnectionStore } from '../lib/ws/connection-store';

export const SERVICE_WORKER_URL = '/sw.js';
export const SKIP_WAITING_MESSAGE = { type: 'SKIP_WAITING' } as const;
/** A window that stays open otherwise only looks for a new build when it is reloaded. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface PageFacts {
  production: boolean;
  protocol: string;
  hostname: string;
  hasServiceWorker: boolean;
}

/**
 * Only the canonical origin (`http://localhost:<port>`) gets a worker: the server redirects
 * 127.0.0.1 there, and a worker on any other origin would cache a shell nobody uses.
 */
export function shouldRegisterServiceWorker(page: PageFacts): boolean {
  return (
    page.production &&
    page.hasServiceWorker &&
    page.protocol === 'http:' &&
    page.hostname === 'localhost'
  );
}

export function showUpdateToast(apply: () => void): void {
  showToast({
    message: i18n.t('pwa.update.message'),
    action: { label: i18n.t('pwa.update.reload'), run: apply },
    durationMs: ACTION_TOAST_MS,
  });
}

export interface RegisterOptions {
  container: ServiceWorkerContainer;
  reload: () => void;
  offerUpdate?: (apply: () => void) => void;
}

export async function registerServiceWorker({
  container,
  reload,
  offerUpdate = showUpdateToast,
}: RegisterOptions): Promise<ServiceWorkerRegistration> {
  let reloadRequested = false;
  let reloading = false;
  container.addEventListener('controllerchange', () => {
    // The first install also takes control of the page (clients.claim); only the reload the
    // user asked for happens here, and only once.
    if (!reloadRequested || reloading) return;
    reloading = true;
    reload();
  });

  const registration = await container.register(SERVICE_WORKER_URL, { scope: '/' });
  const offered = new WeakSet<ServiceWorker>();
  const offer = (worker: ServiceWorker) => {
    // Without a controller this is the first install, not an update: nothing to reload into.
    if (offered.has(worker) || !container.controller) return;
    offered.add(worker);
    offerUpdate(() => {
      reloadRequested = true;
      const waiting = registration.waiting;
      if (waiting) waiting.postMessage(SKIP_WAITING_MESSAGE);
      else reload(); // another window already switched to the new build
    });
  };
  const watch = (worker: ServiceWorker | null) => {
    if (!worker) return;
    if (worker.state === 'installed') {
      offer(worker);
      return;
    }
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') offer(worker);
    });
  };
  watch(registration.waiting);
  watch(registration.installing);
  registration.addEventListener('updatefound', () => watch(registration.installing));
  return registration;
}

/**
 * Looks for a new build every hour and whenever the server comes back after a disconnect (the
 * launcher rebuilds and restarts it). Returns a stop function.
 */
export function startUpdateChecks(
  registration: { update: () => Promise<unknown> },
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
): () => void {
  const check = () => {
    // Offline or server down: the next check tries again.
    registration.update().catch(() => undefined);
  };
  const timer = setInterval(check, intervalMs);
  let wasClosed = useConnectionStore.getState().state === 'closed';
  const unsubscribe = useConnectionStore.subscribe((state) => {
    if (state.state === 'closed') wasClosed = true;
    else if (state.state === 'open' && wasClosed) {
      wasClosed = false;
      check();
    }
  });
  return () => {
    clearInterval(timer);
    unsubscribe();
  };
}

/** Called once at startup (see start-pwa.ts). */
export function startServiceWorker(win: Window = window, production = import.meta.env.PROD): void {
  const container = 'serviceWorker' in win.navigator ? win.navigator.serviceWorker : undefined;
  const page: PageFacts = {
    production,
    protocol: win.location.protocol,
    hostname: win.location.hostname,
    hasServiceWorker: container !== undefined,
  };
  if (!container) return;
  if (!shouldRegisterServiceWorker(page)) {
    // `npm run dev` shares the origin with production: a worker left by a production run would
    // otherwise keep answering dev page loads from its cache.
    if (!production) {
      void container
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
        .catch(() => undefined);
    }
    return;
  }
  const start = () => {
    registerServiceWorker({ container, reload: () => win.location.reload() })
      .then((registration) => startUpdateChecks(registration))
      // A missing or broken sw.js must never stop the app; it simply runs without offline shell.
      .catch(() => undefined);
  };
  // After "load", so precaching never competes with the first paint.
  if (win.document.readyState === 'complete') start();
  else win.addEventListener('load', start, { once: true });
}
