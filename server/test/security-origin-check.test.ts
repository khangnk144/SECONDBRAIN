import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authHeaders, createTestApp, type TestAppHandle } from './helpers/test-environment.js';

const PORT = 4782;
const METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

describe('Origin check on state-changing requests', () => {
  let handle: TestAppHandle;
  beforeAll(async () => {
    handle = await createTestApp(PORT);
    // Stub routes stand in for the real mutation endpoints of later milestones.
    for (const method of METHODS) {
      handle.app.route({ method, url: '/api/__stub', handler: async () => ({ ok: true, method }) });
    }
    await handle.app.ready();
  });
  afterAll(async () => handle.cleanup());

  it.each(METHODS)('%s with a foreign Origin is refused with 403', async (method) => {
    for (const origin of [
      'http://evil.example',
      `http://127.0.0.1:${PORT}`,
      'null',
      `https://localhost:${PORT}`,
      'http://localhost:4999',
    ]) {
      const res = await handle.app.inject({
        method,
        url: '/api/__stub',
        headers: { ...authHeaders(PORT), origin },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
    }
  });

  it.each(METHODS)('%s with the canonical Origin passes', async (method) => {
    const res = await handle.app.inject({
      method,
      url: '/api/__stub',
      headers: { ...authHeaders(PORT), origin: `http://localhost:${PORT}` },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, method });
  });

  it.each(METHODS)('%s without an Origin header passes (same-origin non-CORS)', async (method) => {
    const res = await handle.app.inject({
      method,
      url: '/api/__stub',
      headers: authHeaders(PORT),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  it('foreign Origin is refused even without a token, before any route runs', async () => {
    const res = await handle.app.inject({
      method: 'POST',
      url: '/api/__stub',
      headers: { host: `localhost:${PORT}`, origin: 'http://evil.example' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('never sends CORS headers', async () => {
    const res = await handle.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { ...authHeaders(PORT), origin: 'http://evil.example' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await handle.app.inject({
      method: 'OPTIONS',
      url: '/api/__stub',
      headers: {
        ...authHeaders(PORT),
        origin: 'http://evil.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });
});
