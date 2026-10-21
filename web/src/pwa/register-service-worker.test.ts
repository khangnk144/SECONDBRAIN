import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../i18n';
import { resetToasts, useToastStore } from '../lib/toast-store';
import { useConnectionStore } from '../lib/ws/connection-store';
import {
  registerServiceWorker,
  shouldRegisterServiceWorker,
  showUpdateToast,
  SKIP_WAITING_MESSAGE,
  startServiceWorker,
  startUpdateChecks,
} from './register-service-worker';

class FakeWorker extends EventTarget {
  postMessage = vi.fn();
  constructor(public state: ServiceWorkerState) {
    super();
  }
  moveTo(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  update = vi.fn(async () => undefined);
  unregister = vi.fn(async () => true);
}

class FakeContainer extends EventTarget {
  controller: FakeWorker | null = null;
  registration = new FakeRegistration();
  register = vi.fn(async () => this.registration);
  getRegistrations = vi.fn(async () => [this.registration]);
}

const asContainer = (c: FakeContainer) => c as unknown as ServiceWorkerContainer;

async function setUp(controlled: boolean) {
  const container = new FakeContainer();
  if (controlled) container.controller = new FakeWorker('activated');
  const reload = vi.fn();
  const offerUpdate = vi.fn<(apply: () => void) => void>();
  await registerServiceWorker({ container: asContainer(container), reload, offerUpdate });
  return { container, registration: container.registration, reload, offerUpdate };
}

describe('service worker registration and the update toast (F21.3)', () => {
  beforeAll(() => {
    initI18n('vi');
  });
  afterEach(() => {
    resetToasts();
    vi.useRealTimers();
  });

  it('registers only for production builds on the canonical localhost origin', () => {
    const page = {
      production: true,
      protocol: 'http:',
      hostname: 'localhost',
      hasServiceWorker: true,
    };
    expect(shouldRegisterServiceWorker(page)).toBe(true);
    expect(shouldRegisterServiceWorker({ ...page, production: false })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...page, hostname: '127.0.0.1' })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...page, protocol: 'https:' })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...page, hasServiceWorker: false })).toBe(false);
  });

  it('registers /sw.js for the whole app; the first install offers nothing and never reloads', async () => {
    const { container, registration, reload, offerUpdate } = await setUp(false);
    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    const first = new FakeWorker('installing');
    registration.installing = first;
    registration.dispatchEvent(new Event('updatefound'));
    first.moveTo('installed');
    container.dispatchEvent(new Event('controllerchange'));
    expect(offerUpdate).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('offers a new build once; "Tải lại" activates it and reloads this window once', async () => {
    const { container, registration, reload, offerUpdate } = await setUp(true);
    const next = new FakeWorker('installing');
    registration.installing = next;
    registration.dispatchEvent(new Event('updatefound'));
    next.moveTo('installed');
    registration.installing = null;
    registration.waiting = next;
    next.dispatchEvent(new Event('statechange'));
    expect(offerUpdate).toHaveBeenCalledTimes(1);

    const apply = offerUpdate.mock.calls[0]?.[0];
    apply?.();
    expect(next.postMessage).toHaveBeenCalledWith(SKIP_WAITING_MESSAGE);
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange'));
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('offers a build that was already waiting when the page loaded', async () => {
    const container = new FakeContainer();
    container.controller = new FakeWorker('activated');
    container.registration.waiting = new FakeWorker('installed');
    const offerUpdate = vi.fn();
    await registerServiceWorker({
      container: asContainer(container),
      reload: vi.fn(),
      offerUpdate,
    });
    expect(offerUpdate).toHaveBeenCalledTimes(1);
  });

  it('just reloads when another window already switched to the new build', async () => {
    const container = new FakeContainer();
    container.controller = new FakeWorker('activated');
    container.registration.waiting = new FakeWorker('installed');
    const reload = vi.fn();
    const offerUpdate = vi.fn<(apply: () => void) => void>();
    await registerServiceWorker({ container: asContainer(container), reload, offerUpdate });
    container.registration.waiting = null;
    offerUpdate.mock.calls[0]?.[0]();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('shows "Có bản mới của app." with "Tải lại" for 10 s', () => {
    const apply = vi.fn();
    showUpdateToast(apply);
    const [toast] = useToastStore.getState().toasts;
    expect(toast?.message).toBe('Có bản mới của app.');
    expect(toast?.action?.label).toBe('Tải lại');
    expect(toast?.durationMs).toBe(10_000);
    void toast?.action?.run();
    expect(apply).toHaveBeenCalled();
  });

  it('looks for a new build every hour and when the server comes back', async () => {
    vi.useFakeTimers();
    useConnectionStore.setState({ state: 'open', closedSince: null });
    const registration = { update: vi.fn(async () => undefined) };
    const stop = startUpdateChecks(registration, 1_000);
    vi.advanceTimersByTime(1_000);
    expect(registration.update).toHaveBeenCalledTimes(1);
    useConnectionStore.getState().setState('closed');
    useConnectionStore.getState().setState('open');
    expect(registration.update).toHaveBeenCalledTimes(2);
    registration.update.mockRejectedValueOnce(new TypeError('offline'));
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    stop();
    vi.advanceTimersByTime(5_000);
    expect(registration.update).toHaveBeenCalledTimes(3);
  });
});

function fakeWindow(container: FakeContainer | null, hostname = 'localhost') {
  const listeners: Record<string, () => void> = {};
  const win = {
    navigator: container ? { serviceWorker: container } : {},
    location: { protocol: 'http:', hostname, reload: vi.fn() },
    document: { readyState: 'loading' },
    addEventListener: vi.fn((type: string, listener: () => void) => {
      listeners[type] = listener;
    }),
  };
  return { win: win as unknown as Window, listeners };
}

describe('startServiceWorker', () => {
  it('registers after the load event in production', async () => {
    const container = new FakeContainer();
    const { win, listeners } = fakeWindow(container);
    startServiceWorker(win, true);
    expect(container.register).not.toHaveBeenCalled();
    listeners.load?.();
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled());
  });

  it('removes a worker left by a production run when the app runs in development', async () => {
    const container = new FakeContainer();
    startServiceWorker(fakeWindow(container).win, false);
    await vi.waitFor(() => expect(container.registration.unregister).toHaveBeenCalled());
    expect(container.register).not.toHaveBeenCalled();
  });

  it('does nothing without service worker support or off the canonical origin', () => {
    expect(() => startServiceWorker(fakeWindow(null).win, true)).not.toThrow();
    const container = new FakeContainer();
    const { win, listeners } = fakeWindow(container, '127.0.0.1');
    startServiceWorker(win, true);
    expect(listeners.load).toBeUndefined();
    expect(container.getRegistrations).not.toHaveBeenCalled();
  });

  it('keeps the app running when registration fails', async () => {
    const container = new FakeContainer();
    container.register.mockRejectedValueOnce(new TypeError('404'));
    const { win, listeners } = fakeWindow(container);
    startServiceWorker(win, true);
    expect(() => listeners.load?.()).not.toThrow();
    await vi.waitFor(() => expect(container.register).toHaveBeenCalled());
  });
});
