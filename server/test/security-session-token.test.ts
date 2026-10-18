import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  generateSessionToken,
  isWellFormedToken,
  tokensMatch,
} from '../src/security/session-token.js';
import {
  authHeaders,
  createTestApp,
  TEST_TOKEN,
  type TestAppHandle,
} from './helpers/test-environment.js';

const PORT = 4783;

describe('Session token helpers', () => {
  it('generates unique 43-char base64url tokens', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isWellFormedToken(a)).toBe(true);
  });

  it('compares tokens exactly', () => {
    expect(tokensMatch(TEST_TOKEN, TEST_TOKEN)).toBe(true);
    expect(tokensMatch(TEST_TOKEN, `${TEST_TOKEN}x`)).toBe(false);
    expect(tokensMatch(TEST_TOKEN, TEST_TOKEN.slice(0, -1))).toBe(false);
    expect(tokensMatch(TEST_TOKEN, '')).toBe(false);
    expect(tokensMatch(TEST_TOKEN, undefined)).toBe(false);
  });
});

describe('Session token on /api', () => {
  let handle: TestAppHandle;
  beforeAll(async () => {
    handle = await createTestApp(PORT);
    handle.app.post('/api/__stub', async () => ({ ok: true }));
    await handle.app.ready();
  });
  afterAll(async () => handle.cleanup());

  it('health needs no token and reports the app identity', async () => {
    const res = await handle.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: `localhost:${PORT}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      app: 'second-brain',
      version: expect.any(String),
      vaultId: null,
    });
  });

  it.each([
    ['missing', undefined],
    ['wrong', 'wrong-token'],
    ['almost right', `${TEST_TOKEN.slice(0, -1)}B`],
  ])('%s token → 401 on GET and POST', async (_label, token) => {
    const headers: Record<string, string> = { host: `localhost:${PORT}` };
    if (token) headers['x-sb-token'] = token;
    for (const [method, url] of [
      ['GET', '/api/settings'],
      ['POST', '/api/__stub'],
      ['GET', '/api/does-not-exist'],
    ] as const) {
      const res = await handle.app.inject({ method, url, headers });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
    }
  });

  it('right token → 200', async () => {
    expect(
      (await handle.app.inject({ method: 'GET', url: '/api/settings', headers: authHeaders(PORT) }))
        .statusCode,
    ).toBe(200);
    expect(
      (await handle.app.inject({ method: 'POST', url: '/api/__stub', headers: authHeaders(PORT) }))
        .statusCode,
    ).toBe(200);
  });

  it('a token in the query string is not accepted for /api', async () => {
    const res = await handle.app.inject({
      method: 'GET',
      url: `/api/settings?token=${TEST_TOKEN}`,
      headers: { host: `localhost:${PORT}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('percent-encoded or differently cased API paths cannot skip the token check', async () => {
    for (const url of [
      '/%61pi/settings',
      '/API/settings',
      '/api%2Fsettings',
      '/api/health/../settings',
    ]) {
      const res = await handle.app.inject({
        method: 'GET',
        url,
        headers: { host: `localhost:${PORT}` },
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it('unknown API routes answer a JSON 404 once authenticated', async () => {
    const res = await handle.app.inject({
      method: 'GET',
      url: '/api/nope',
      headers: authHeaders(PORT),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});
