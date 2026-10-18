import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authHeaders, createTestApp, type TestAppHandle } from './helpers/test-environment.js';

const PORT = 4781;

describe('Host allowlist', () => {
  let handle: TestAppHandle;
  beforeAll(async () => {
    handle = await createTestApp(PORT);
    await handle.app.ready();
  });
  afterAll(async () => handle.cleanup());

  it.each(['evil.example:4781', 'localhost:4999', 'attacker.localhost:4781', '127.0.0.2:4781', ''])(
    'rejects Host "%s" with 421 on API, health and shell',
    async (host) => {
      for (const url of ['/api/health', '/api/settings', '/']) {
        const res = await handle.app.inject({
          method: 'GET',
          url,
          headers: { host, 'x-sb-token': handle.settings.sessionToken },
        });
        expect(res.statusCode).toBe(421);
        expect(res.json()).toEqual({
          error: { code: 'MISDIRECTED_REQUEST', message: expect.any(String) },
        });
      }
    },
  );

  it('accepts localhost:<port> and 127.0.0.1:<port> for the API', async () => {
    for (const host of [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `LOCALHOST:${PORT}`]) {
      const res = await handle.app.inject({
        method: 'GET',
        url: '/api/settings',
        headers: { ...authHeaders(PORT), host },
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it('redirects a shell request on 127.0.0.1 to the canonical localhost origin', async () => {
    const res = await handle.app.inject({
      method: 'GET',
      url: '/?x=1',
      headers: { host: `127.0.0.1:${PORT}`, accept: 'text/html' },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`http://localhost:${PORT}/?x=1`);
  });

  it('answers API calls on 127.0.0.1 directly instead of redirecting them', async () => {
    const health = await handle.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: `127.0.0.1:${PORT}` },
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true, app: 'second-brain' });

    const settings = await handle.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { host: `127.0.0.1:${PORT}`, 'x-sb-token': handle.settings.sessionToken },
    });
    expect(settings.statusCode).toBe(200);
  });

  it('applies the allowlist to WebSocket upgrades too', async () => {
    const res = await handle.app.inject({
      method: 'GET',
      url: `/ws?token=${handle.settings.sessionToken}`,
      headers: { host: 'evil.example', upgrade: 'websocket', connection: 'upgrade' },
    });
    expect(res.statusCode).toBe(421);
  });
});
