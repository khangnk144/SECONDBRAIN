import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_TOKEN } from '../helpers/test-environment.js';
import { createMemoryLogger, createVaultTestApp, q, type VaultTestApp } from './vault-test-app.js';

const PORT = 47617;
const KEYS = {
  anthropic: 'sk-ant-api03-ANTHROPICSECRET0000000000000000-aaaa',
  openai: 'sk-proj-OPENAISECRET11111111111111111111111-bbbb',
  gemini: 'AIzaSyGEMINISECRET2222222222222222222-cccc',
};

describe('secrets never leave settings.json (F18.2)', () => {
  let t: VaultTestApp;
  const logger = createMemoryLogger();
  const secrets = () => [TEST_TOKEN, ...Object.values(KEYS)];
  const expectNoSecret = (body: string, label: string) => {
    for (const secret of secrets()) {
      expect(body.includes(secret), `${label} leaks ${secret.slice(0, 8)}…`).toBe(false);
      expect(body.includes(secret.slice(0, 16)), `${label} leaks a prefix`).toBe(false);
    }
  };

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { logger, persistSettings: true });
    // A reminders store exists, like in a vault where reminders fired.
    const state = t.context.vault.paths.stateDir;
    mkdirSync(state, { recursive: true });
    writeFileSync(path.join(state, 'reminders.json'), '{"version":1,"entries":[]}\n');
  });
  afterAll(async () => t?.close());

  it('no response of the settings, health or tree routes contains a key or the token', async () => {
    for (const [provider, value] of Object.entries(KEYS)) {
      const res = await t.call('PUT', '/api/settings', { ai: { apiKey: { provider, value } } });
      expect(res.statusCode).toBe(200);
      expectNoSecret(res.body, `PUT /settings (${provider})`);
      expect(res.json().ai.keys[provider]).toEqual({ set: true, last4: `…${value.slice(-4)}` });
    }
    for (const url of ['/api/settings', '/api/health', '/api/tree']) {
      const res = await t.call('GET', url);
      expect(res.statusCode).toBe(200);
      expectNoSecret(res.body, url);
    }
    expectNoSecret(logger.lines.join('\n'), 'the log');
  });

  it.each([
    ['the global settings file through ..', '../.secondbrain/settings.json'],
    ['the reminders state', '.secondbrain/state/reminders.json'],
    ['the vault identity', '.secondbrain/vault.json'],
  ])('GET /api/files with %s → 400 INVALID_PATH', async (_label, target) => {
    const res = await t.call('GET', `/api/files?${q(target)}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVALID_PATH');
    expectNoSecret(res.body, target);
  });

  it('GET /api/files with the absolute path of settings.json → 400 INVALID_PATH', async () => {
    const absolute = path.join(t.home, '.secondbrain', 'settings.json');
    for (const form of [absolute, absolute.split(path.sep).join('/')]) {
      const res = await t.call('GET', `/api/files?${q(form)}`);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('INVALID_PATH');
      expectNoSecret(res.body, form);
    }
  });
});
