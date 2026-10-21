import { readFileSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AiRuntime } from '../../src/ai/ai-types.js';
import { registerSettingsRoutes } from '../../src/api/settings-route.js';
import { normalizeSettings } from '../../src/config/global-settings.js';
import { createSettingsStore } from '../../src/config/settings-store.js';
import type { ServerEvent } from '../../src/ws/server-events.js';
import type { WebSocketHub } from '../../src/ws/websocket-hub.js';
import { createVaultTestApp, type VaultTestApp } from './vault-test-app.js';

const PORT = 47736;
const KEY = 'sk-ant-api03-SETTINGSKEY0000000000000000000-abcd';

describe('AI consent, limits and MCP settings through PUT /api/settings (F33, F32)', () => {
  let t: VaultTestApp;
  const events: ServerEvent[] = [];
  const put = (body: unknown) => t.call('PUT', '/api/settings', body);
  const stored = () =>
    JSON.parse(readFileSync(path.join(t.home, '.secondbrain', 'settings.json'), 'utf8'));

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { persistSettings: true });
    t.host.hub.add({
      readyState: 1,
      bufferedAmount: 0,
      send: (data: string) => void events.push(JSON.parse(data) as ServerEvent),
      terminate: () => undefined,
      on: () => undefined,
    });
  });
  afterAll(async () => t?.close());

  it('turning AI on needs consent in the same request (recorded with time and provider)', async () => {
    const res = await put({
      ai: { consent: true, enabled: true, apiKey: { provider: 'anthropic', value: KEY } },
    });
    expect(res.statusCode, res.body).toBe(200);
    const { ai } = res.json();
    expect(ai).toMatchObject({ enabled: true, consent: { provider: 'anthropic' } });
    expect(Date.parse(ai.consent.at)).toBeGreaterThan(Date.now() - 60_000);
    expect(stored().ai.consent).toEqual(ai.consent);
    expect(res.body).not.toContain(KEY);
    // Resending the section later is fine: the stored consent counts.
    expect((await put({ ai: { enabled: true } })).statusCode).toBe(200);
  });

  it('a provider change keeps the old consent stored but it no longer counts', async () => {
    const changed = await put({ ai: { provider: 'openai' } });
    expect(changed.json().ai).toMatchObject({
      provider: 'openai',
      enabled: true,
      consent: { provider: 'anthropic' },
    });
    const refused = await put({ ai: { enabled: true } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.details).toEqual({
      field: 'ai.enabled',
      reason: 'consent-required',
    });
    const agreed = await put({ ai: { consent: true, enabled: true } });
    expect(agreed.json().ai.consent.provider).toBe('openai');
    // Switching provider and agreeing in one request records consent for the new provider.
    const both = await put({ ai: { provider: 'gemini', consent: true, enabled: true } });
    expect(both.json().ai).toMatchObject({ provider: 'gemini', consent: { provider: 'gemini' } });
  });

  it('embeddings are a separate opt-in tied to the embedding provider', async () => {
    expect((await put({ ai: { embeddings: true } })).statusCode).toBe(400);
    const on = await put({ ai: { embeddings: true, embeddingsConsent: true } });
    expect(on.json().ai).toMatchObject({
      embeddings: true,
      embeddingProvider: 'openai',
      embeddingsConsent: { provider: 'openai' },
    });
    const gemini = await put({ ai: { embeddingProvider: 'gemini' } });
    expect(gemini.json().ai.embeddingsConsent.provider).toBe('openai');
    const again = await put({ ai: { embeddings: true } });
    expect(again.json().error.details).toEqual({
      field: 'ai.embeddings',
      reason: 'consent-required',
    });
    expect((await put({ ai: { embeddingsConsent: true, embeddings: true } })).statusCode).toBe(200);
  });

  it('withdrawing consent, the monthly limit and mcp.allowNoteEdits are stored and answered', async () => {
    const res = await put({
      ai: { consent: false, monthlyTokenLimit: 500_000 },
      mcp: { allowNoteEdits: true },
    });
    expect(res.json().ai).toMatchObject({ consent: null, monthlyTokenLimit: 500_000 });
    expect(res.json().mcp).toEqual({ allowNoteEdits: true });
    expect(stored().mcp).toEqual({ allowNoteEdits: true });
    expect(stored().ai.monthlyTokenLimit).toBe(500_000);
    expect(t.settings.mcp).toEqual({ allowNoteEdits: true }); // the live object MCP reads
  });

  it('a refused request changes nothing at all', async () => {
    const before = JSON.stringify(t.settings);
    const res = await put({ ui: { theme: 'light' }, ai: { provider: 'anthropic', enabled: true } });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(t.settings)).toBe(before);
  });

  it('an ai or mcp change is announced as ai:status; a ui change is not', async () => {
    events.length = 0;
    await put({ mcp: { allowNoteEdits: false } });
    await put({ ai: { chatModel: 'model-x' } });
    await put({ ui: { fontSize: 18 } });
    await put({ ai: { chatModel: 'model-x' } }); // no change
    expect(events.filter((e) => e.type === 'ai:status')).toEqual([
      { type: 'ai:status', embeddings: { state: 'off', done: 0, total: 0 } },
      { type: 'ai:status', embeddings: { state: 'off', done: 0, total: 0 } },
    ]);
  });
});

describe('PUT /api/settings hands AI changes to the running AI plugin', () => {
  it('calls settingsChanged() instead of broadcasting itself', async () => {
    const settings = normalizeSettings({ sessionToken: 'x'.repeat(43) });
    const broadcasts: ServerEvent[] = [];
    const hub = { broadcast: (e: ServerEvent) => broadcasts.push(e) } as unknown as WebSocketHub;
    let calls = 0;
    const runtime = { settingsChanged: () => (calls += 1) } as unknown as AiRuntime;
    const app = Fastify();
    registerSettingsRoutes(app, {
      store: createSettingsStore(
        () => settings,
        async () => {},
      ),
      port: PORT,
      platform: 'linux',
      runAtLogin: { supported: false, isEnabled: async () => false, setEnabled: async () => {} },
      vaultInfo: () => null,
      hub,
      ai: () => runtime,
      now: () => new Date('2026-10-21T09:30:00+07:00'),
    });
    try {
      const put = (payload: unknown) =>
        app.inject({ method: 'PUT', url: '/api/settings', payload: payload as object });
      const res = await put({ ai: { consent: true, monthlyTokenLimit: 20_000 } });
      expect(res.json().ai.consent).toEqual({
        at: '2026-10-21T02:30:00.000Z',
        provider: 'anthropic',
      });
      await put({ ui: { theme: 'light' } });
      expect(calls).toBe(1);
      expect(broadcasts.filter((e) => e.type === 'ai:status')).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
