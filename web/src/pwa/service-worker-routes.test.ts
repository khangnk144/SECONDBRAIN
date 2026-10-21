import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cacheNameFor,
  classifyRequest,
  isCacheableShellResponse,
  staleCacheNames,
  withTimeout,
} from './service-worker-routes';

const ORIGIN = 'http://localhost:4747';
const PRECACHE = new Set(['/assets/index-abc.js', '/manifest.webmanifest', '/icons/icon-192.png']);
const get = (path: string, mode = 'no-cors') => ({ method: 'GET', mode, url: `${ORIGIN}${path}` });

describe('service worker request routing (F21.3)', () => {
  it('answers page loads with the network-first shell', () => {
    for (const path of ['/', '/note?path=a.md', '/calendar', '/settings']) {
      expect(classifyRequest(get(path, 'navigate'), ORIGIN, PRECACHE), path).toBe('navigation');
    }
  });

  it('serves built assets, icons and the manifest from the precache', () => {
    for (const path of ['/assets/index-abc.js', '/manifest.webmanifest', '/icons/icon-192.png']) {
      expect(classifyRequest(get(path), ORIGIN, PRECACHE), path).toBe('precache');
    }
    // Lazy chunks of another build still live under /assets/ (cache first, then network).
    expect(classifyRequest(get('/assets/other-build.js'), ORIGIN, PRECACHE)).toBe('precache');
  });

  it('never intercepts the API, the WebSocket or anything outside the shell', () => {
    const passthrough = [
      get('/api/health'),
      get('/api/files?path=a.png'),
      get('/api/note', 'navigate'),
      get('/api', 'navigate'),
      get('/ws?token=x'),
      get('/ws', 'navigate'),
      get('/sw.js'),
      get('/random.txt'),
      get('/assets/index-abc.js?v=2'),
      { method: 'POST', mode: 'cors', url: `${ORIGIN}/api/note` },
      { method: 'POST', mode: 'navigate', url: `${ORIGIN}/` },
      { method: 'GET', mode: 'navigate', url: 'http://127.0.0.1:4747/' },
      { method: 'GET', mode: 'cors', url: 'https://example.com/assets/x.js' },
      { method: 'GET', mode: 'cors', url: 'not a url' },
    ];
    for (const request of passthrough) {
      expect(classifyRequest(request, ORIGIN, PRECACHE), JSON.stringify(request)).toBe(
        'passthrough',
      );
    }
  });

  it('stores only complete same-origin HTML pages as the shell', () => {
    const ok = {
      status: 200,
      type: 'basic',
      redirected: false,
      contentType: 'text/html; charset=utf-8',
    };
    expect(isCacheableShellResponse(ok)).toBe(true);
    expect(isCacheableShellResponse({ ...ok, status: 503 })).toBe(false);
    expect(isCacheableShellResponse({ ...ok, status: 404 })).toBe(false);
    expect(isCacheableShellResponse({ ...ok, type: 'opaqueredirect', status: 0 })).toBe(false);
    expect(isCacheableShellResponse({ ...ok, redirected: true })).toBe(false);
    expect(isCacheableShellResponse({ ...ok, contentType: 'text/plain; charset=utf-8' })).toBe(
      false,
    );
    expect(isCacheableShellResponse({ ...ok, contentType: null })).toBe(false);
  });

  it('names caches per build and finds the ones of earlier builds', () => {
    const current = cacheNameFor('b2');
    expect(current).toBe('sb-shell-b2');
    expect(
      staleCacheNames(['sb-shell-b1', current, 'other-cache', 'sb-shell-b0'], current),
    ).toEqual(['sb-shell-b1', 'sb-shell-b0']);
  });
});

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes the result through and rejects with TimeoutError when too slow', async () => {
    await expect(withTimeout(Promise.resolve(1), 10)).resolves.toBe(1);
    await expect(withTimeout(Promise.reject(new Error('down')), 10)).rejects.toThrow('down');
    vi.useFakeTimers();
    const slow = withTimeout(new Promise(() => undefined), 4_000);
    vi.advanceTimersByTime(4_000);
    await expect(slow).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});
