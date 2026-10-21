// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteStaleCaches,
  handleNavigation,
  handlePrecached,
  installBuild,
  type ShellStore,
} from './service-worker-strategies';

const ORIGIN = 'http://localhost:4747';

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** Responses built with `new Response()` have type "default"; real same-origin ones are "basic". */
function basic(response: Response): Response {
  Object.defineProperty(response, 'type', { value: 'basic' });
  return response;
}

function makeStore(fetchImpl: ShellStore['fetch'], shell?: Response) {
  let stored: Response | undefined = shell;
  const store: ShellStore = {
    fetch: vi.fn(fetchImpl),
    readShell: vi.fn(async () => stored?.clone()),
    storeShell: vi.fn(async (response: Response) => {
      stored = response;
    }),
    matchCached: vi.fn(async () => undefined),
  };
  return { store, storedText: async () => stored?.clone().text() };
}

const navigation = () => new Request(`${ORIGIN}/calendar`);

describe('navigation: network first, cached shell when the server is down (F21.3)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the server page and stores it as the new shell', async () => {
    const { store, storedText } = makeStore(async () => basic(html('fresh shell')));
    const result = handleNavigation(navigation(), store);
    await expect((await result.response).text()).resolves.toBe('fresh shell');
    await result.stored;
    await expect(storedText()).resolves.toBe('fresh shell');
  });

  it('does not store error pages or non-HTML answers, but still shows them', async () => {
    const { store } = makeStore(async () => basic(html('UI not built', 503)), html('old shell'));
    const result = handleNavigation(navigation(), store);
    expect((await result.response).status).toBe(503);
    await result.stored;
    expect(store.storeShell).not.toHaveBeenCalled();
  });

  it('shows the cached shell when the server cannot be reached', async () => {
    const { store } = makeStore(async () => {
      throw new TypeError('Failed to fetch');
    }, html('cached shell'));
    const result = handleNavigation(navigation(), store);
    await expect((await result.response).text()).resolves.toBe('cached shell');
    await expect(result.stored).resolves.toBeUndefined();
  });

  it('shows the cached shell after 4 s when the server hangs', async () => {
    vi.useFakeTimers();
    const { store } = makeStore(() => new Promise<Response>(() => undefined), html('cached shell'));
    const result = handleNavigation(navigation(), store);
    await vi.advanceTimersByTimeAsync(4_000);
    await expect((await result.response).text()).resolves.toBe('cached shell');
  });

  it('keeps waiting for a slow server when there is no shell yet, and fails like the network', async () => {
    vi.useFakeTimers();
    let answer: (response: Response) => void = () => undefined;
    const { store } = makeStore(() => new Promise<Response>((resolve) => (answer = resolve)));
    const result = handleNavigation(navigation(), store);
    await vi.advanceTimersByTimeAsync(5_000);
    answer(basic(html('late shell')));
    await expect((await result.response).text()).resolves.toBe('late shell');

    const offline = makeStore(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(handleNavigation(navigation(), offline.store).response).rejects.toThrow(
      'Failed to fetch',
    );
  });
});

describe('precached files: cache first', () => {
  it('answers from any cache of the origin, else from the network', async () => {
    const { store } = makeStore(async () => new Response('from network'));
    const request = new Request(`${ORIGIN}/assets/app.js`);
    await expect((await handlePrecached(request, store)).text()).resolves.toBe('from network');
    vi.mocked(store.matchCached).mockResolvedValueOnce(new Response('from cache'));
    await expect((await handlePrecached(request, store)).text()).resolves.toBe('from cache');
  });
});

describe('install and activate', () => {
  it('precaches every build file bypassing the HTTP cache, then stores the shell', async () => {
    const addAll = vi.fn(async (_requests: Request[]) => undefined);
    const put = vi.fn(async () => undefined);
    const fetchShell = vi.fn(async () => basic(html('shell')));
    await installBuild({ addAll, put }, [`${ORIGIN}/assets/a.js`], `${ORIGIN}/`, fetchShell);
    const requests = addAll.mock.calls[0]?.[0] ?? [];
    expect(requests.map((r) => [r.url, r.cache])).toEqual([[`${ORIGIN}/assets/a.js`, 'reload']]);
    expect(put).toHaveBeenCalledWith(`${ORIGIN}/`, expect.any(Response));
  });

  it('installs even when the shell cannot be fetched, and fails when a build file is missing', async () => {
    const put = vi.fn(async () => undefined);
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await installBuild({ addAll: async () => undefined, put }, [], `${ORIGIN}/`, offline);
    expect(put).not.toHaveBeenCalled();
    const missing = async () => {
      throw new TypeError('Request failed');
    };
    await expect(
      installBuild({ addAll: missing, put }, ['x'], `${ORIGIN}/`, offline),
    ).rejects.toThrow();
  });

  it('deletes only the caches of earlier builds', async () => {
    const deleted: string[] = [];
    const caches = {
      keys: async () => ['sb-shell-old', 'sb-shell-new', 'someone-else'],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    };
    await expect(deleteStaleCaches(caches, 'sb-shell-new')).resolves.toEqual(['sb-shell-old']);
    expect(deleted).toEqual(['sb-shell-old']);
  });
});
