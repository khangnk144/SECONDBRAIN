import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiError, type AiErrorCode } from '../../src/ai/ai-types.js';
import { aiApiError, sendAiError } from '../../src/api/ai-status-routes.js';
import { TEST_TOKEN } from '../helpers/test-environment.js';
import { configureAi, createAiTestApp, type AiTestApp } from '../ai/runtime/ai-test-kit.js';
import { createVaultTestApp, type VaultTestApp } from './vault-test-app.js';

const PORT = 47737;
const ROUTES = [
  { method: 'GET', url: '/api/ai/status' },
  { method: 'POST', url: '/api/ai/embeddings/rebuild' },
] as const;

describe('AI status routes without the AI plugin', () => {
  let t: VaultTestApp;

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      beforeReady: (app) => {
        // A test route for the shared AiError mapping.
        app.get('/api/test/ai-error', async (request, reply) => {
          const code = (request.query as { code: AiErrorCode }).code;
          const error = new AiError(code, 'Refused.', { reason: 'x' });
          if ((request.query as { send?: string }).send) return sendAiError(reply, error);
          throw aiApiError(error);
        });
      },
    });
  });
  afterAll(async () => t?.close());

  it('GET answers available: false with everything off; POST rebuild is 503', async () => {
    t.settings.ai.enabled = true; // stored, but no plugin runs it
    const res = await t.call('GET', '/api/ai/status');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      available: false,
      enabled: false,
      ready: false,
      reason: 'disabled',
      retrieval: 'bm25',
      embeddings: { enabled: false, state: 'off', done: 0, total: 0, pending: 0 },
      usage: { tokens: 0, paused: false },
      scope: [],
    });
    const rebuild = await t.call('POST', '/api/ai/embeddings/rebuild');
    expect(rebuild.statusCode).toBe(503);
    expect(rebuild.json().error.code).toBe('UNAVAILABLE');
  });

  it.each([
    ['AI_DISABLED', 409],
    ['AI_NO_KEY', 409],
    ['AI_BUDGET', 429],
    ['AI_PROVIDER_ERROR', 502],
  ])('%s maps to HTTP %i (thrown or sent)', async (code, status) => {
    for (const query of [`code=${code}`, `code=${code}&send=1`]) {
      const res = await t.call('GET', `/api/test/ai-error?${query}`);
      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({
        error: { code, message: 'Refused.', details: { reason: 'x' } },
      });
    }
  });

  it.each(ROUTES)('$method $url: missing or wrong token → 401, wrong Host → 421', async (route) => {
    for (const headers of [
      { host: `localhost:${PORT}` },
      { host: `localhost:${PORT}`, 'x-sb-token': 'nope' },
    ]) {
      const res = await t.app.inject({ method: route.method, url: route.url, headers });
      expect(res.statusCode).toBe(401);
    }
    const misdirected = await t.app.inject({
      method: route.method,
      url: route.url,
      headers: { host: 'evil.example', 'x-sb-token': TEST_TOKEN },
    });
    expect(misdirected.statusCode).toBe(421);
  });

  it('POST rebuild with a foreign Origin → 403 before anything runs', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/ai/embeddings/rebuild',
      headers: {
        host: `localhost:${PORT}`,
        'x-sb-token': TEST_TOKEN,
        origin: 'http://evil.example',
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/ai/embeddings/rebuild with the AI plugin', () => {
  let t: AiTestApp;
  beforeAll(async () => {
    t = await createAiTestApp(PORT + 1);
  });
  afterAll(async () => t?.close());

  it('refuses unknown body fields, then AI off, no key, and accepts when active', async () => {
    const strict = await t.call('POST', '/api/ai/embeddings/rebuild', { force: true });
    expect(strict.statusCode).toBe(400);
    expect(strict.json().error.details).toEqual({ field: 'force', reason: 'unknown-field' });
    const off = await t.call('POST', '/api/ai/embeddings/rebuild');
    expect(off.statusCode).toBe(409);
    expect(off.json().error).toMatchObject({
      code: 'AI_DISABLED',
      details: { reason: 'disabled' },
    });
    configureAi(t, { embeddings: true, keys: false });
    const noKey = await t.call('POST', '/api/ai/embeddings/rebuild', {});
    expect(noKey.statusCode).toBe(409);
    expect(noKey.json().error.code).toBe('AI_NO_KEY');
    configureAi(t, { embeddings: true });
    const ok = await t.call('POST', '/api/ai/embeddings/rebuild', {});
    expect(ok.statusCode).toBe(202);
    expect(typeof ok.json().started).toBe('boolean');
  });
});
