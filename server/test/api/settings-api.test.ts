import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRunAtLoginService } from '../../src/system/run-at-login.js';
import type { HubSocket } from '../../src/ws/websocket-hub.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import { createVaultTestApp, type VaultTestApp } from './vault-test-app.js';

const PORT = 47735;
const KEY = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789wxyz';

/** Records every hub broadcast like a connected WebSocket client. */
function recordingSocket(): HubSocket & { events: { type: string; ui?: unknown }[] } {
  const events: { type: string }[] = [];
  return {
    readyState: 1,
    bufferedAmount: 0,
    events,
    send: (data: string) => void events.push(JSON.parse(data)),
    terminate: () => undefined,
    on: () => undefined,
  };
}

describe('GET/PUT /api/settings (F18.1, F18.2, F18.6)', () => {
  let t: VaultTestApp;
  let startup: string;
  let socket: ReturnType<typeof recordingSocket>;
  let powerShellRuns = 0;
  const put = (body: unknown) => t.call('PUT', '/api/settings', body);
  const stored = () =>
    JSON.parse(readFileSync(path.join(t.home, '.secondbrain', 'settings.json'), 'utf8'));

  beforeAll(async () => {
    startup = makeTempDir('sb Startup Khởi động');
    t = await createVaultTestApp(PORT, {
      persistSettings: true,
      platform: 'win32',
      runAtLogin: createRunAtLoginService({
        appDir: 'D:\\SECONDBRAIN\\app',
        platform: 'win32',
        startupDir: startup,
        runPowerShell: async () => {
          powerShellRuns += 1;
          writeFileSync(path.join(startup, 'Second Brain.lnk'), 'lnk');
        },
      }),
    });
    socket = recordingSocket();
    t.host.hub.add(socket);
  });
  afterAll(async () => {
    await t?.close();
    removeDir(startup);
  });

  it('GET answers the allowlisted view with the open vault and masked keys', async () => {
    const res = await t.call('GET', '/api/settings');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      port: PORT,
      configuredPort: PORT,
      restartRequired: false,
      ui: { name: 'khangnie', language: 'vi', theme: 'dark', palette: 'dau-tam', fontSize: 16 },
      reminders: { time: '08:00' },
      system: { runAtLogin: false, runAtLoginSupported: true, platform: 'windows' },
      vault: {
        path: t.vaultRoot,
        id: t.context.vault.id,
        isDefault: true,
        defaultPath: path.join(t.home, 'vault'),
      },
      ai: {
        provider: 'anthropic',
        keys: {
          anthropic: { set: false, last4: null },
          openai: { set: false, last4: null },
          gemini: { set: false, last4: null },
        },
        chatModel: null,
        embeddingModel: null,
        folders: null,
        enabled: false,
        embeddings: false,
        consent: null,
        embeddingsConsent: null,
        embeddingProvider: 'openai',
        monthlyTokenLimit: 2_000_000,
      },
      mcp: { allowNoteEdits: false },
    });
  });

  it('PUT ui applies in place, is saved, answers like GET and tells other windows', async () => {
    socket.events.length = 0;
    const res = await put({ ui: { name: '  Khang Nhi ', theme: 'light', fontSize: 18 } });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().ui).toEqual({
      name: 'Khang Nhi',
      language: 'vi',
      theme: 'light',
      palette: 'dau-tam',
      fontSize: 18,
    });
    expect(res.json()).toEqual((await t.call('GET', '/api/settings')).json());
    expect(t.settings.ui.theme).toBe('light'); // the live object other modules read
    expect(stored().ui).toMatchObject({ name: 'Khang Nhi', theme: 'light', fontSize: 18 });
    expect(socket.events).toEqual([{ type: 'settings:changed', ui: res.json().ui }]);

    socket.events.length = 0;
    await put({ reminders: { time: '07:45' } });
    expect(t.settings.reminders.time).toBe('07:45');
    expect(socket.events).toEqual([]); // no UI change, no event
  });

  it.each([
    [{ sessionToken: 'x'.repeat(43) }, 'sessionToken', 'unknown-field'],
    [{ vaultPath: '/tmp/other' }, 'vaultPath', 'unknown-field'],
    [{ ui: { color: 'red' } }, 'ui.color', 'unknown-field'],
    [{ ui: { fontSize: '16' } }, 'ui.fontSize', 'type'],
    [{ ui: { fontSize: 15 } }, 'ui.fontSize', 'not-allowed'],
    [{ ui: { language: 'fr' } }, 'ui.language', 'not-allowed'],
    [{ ui: { name: '   ' } }, 'ui.name', 'too-short'],
    [{ ui: { name: 'ă'.repeat(81) } }, 'ui.name', 'too-long'],
    [{ reminders: { time: '24:00' } }, 'reminders.time', 'pattern'],
    [{ reminders: { time: '8:00' } }, 'reminders.time', 'pattern'],
    [{ port: 1023 }, 'port', 'out-of-range'],
    [{ port: 47.5 }, 'port', 'type'],
    [{ ai: { enabled: true } }, 'ai.enabled', 'consent-required'],
    [{ ai: { embeddings: true } }, 'ai.embeddings', 'consent-required'],
    [{ ai: { enabled: true, embeddingsConsent: true } }, 'ai.enabled', 'consent-required'],
    [{ ai: { consent: 'yes' } }, 'ai.consent', 'type'],
    [{ ai: { embeddingProvider: 'anthropic' } }, 'ai.embeddingProvider', 'not-allowed'],
    [{ ai: { monthlyTokenLimit: 9_999 } }, 'ai.monthlyTokenLimit', 'out-of-range'],
    [{ ai: { monthlyTokenLimit: 100_000_001 } }, 'ai.monthlyTokenLimit', 'out-of-range'],
    [{ ai: { monthlyTokenLimit: 50_000.5 } }, 'ai.monthlyTokenLimit', 'type'],
    [{ mcp: { allowNoteEdits: 'true' } }, 'mcp.allowNoteEdits', 'type'],
    [{ mcp: { other: true } }, 'mcp.other', 'unknown-field'],
    [
      { ai: { apiKey: { provider: 'openai', value: 'short' } } },
      'ai.apiKey.value',
      'api-key-format',
    ],
    [{ ai: { apiKey: { provider: 'mistral', value: KEY } } }, 'ai.apiKey.provider', 'not-allowed'],
    [{ ai: { apiKey: { provider: 'openai' } } }, 'ai.apiKey.value', 'required'],
    [{ ai: { folders: ['2 Areas', '../ngoài'] } }, 'ai.folders.1', 'invalid-path'],
    [{ ai: { folders: ['.secondbrain'] } }, 'ai.folders.0', 'invalid-path'],
    [[], 'body', 'type'],
  ])('PUT %j → 400 VALIDATION on %s (%s), nothing changes', async (body, field, reason) => {
    const before = JSON.stringify(t.settings);
    const res = await put(body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'VALIDATION', details: { field, reason } });
    expect(JSON.stringify(t.settings)).toBe(before);
  });

  it('the port is saved for the next start and flagged as needing a restart', async () => {
    const res = await put({ port: 5050 });
    expect(res.json()).toMatchObject({ port: PORT, configuredPort: 5050, restartRequired: true });
    expect(stored().port).toBe(5050);
    await put({ port: PORT });
  });

  it('API keys are stored in settings.json only and answered as …last4', async () => {
    const res = await put({
      ai: { provider: 'openai', apiKey: { provider: 'openai', value: ` ${KEY} ` } },
    });
    expect(res.json().ai.provider).toBe('openai');
    expect(res.json().ai.keys.openai).toEqual({ set: true, last4: '…wxyz' });
    expect(res.body).not.toContain(KEY);
    expect(res.body).not.toContain(KEY.slice(0, 20));
    expect(stored().ai.apiKeys.openai).toBe(KEY);
    const removed = await put({ ai: { apiKey: { provider: 'openai', value: null } } });
    expect(removed.json().ai.keys.openai).toEqual({ set: false, last4: null });
    expect(stored().ai.apiKeys).toEqual({});
  });

  it('AI models and folder scope are cleaned and stored; switching AI off is accepted', async () => {
    const res = await put({
      ai: {
        chatModel: ' claude-sonnet ',
        embeddingModel: '',
        folders: ['2 Areas/', '1 Projects/Đồ án', '2 Areas'],
        enabled: false,
      },
    });
    expect(res.json().ai).toMatchObject({
      chatModel: 'claude-sonnet',
      embeddingModel: null,
      folders: ['2 Areas', '1 Projects/Đồ án'],
      enabled: false,
    });
    expect((await put({ ai: { folders: null } })).json().ai.folders).toBeNull();
  });

  it('run at login creates and removes the Startup shortcut on disk', async () => {
    const lnk = path.join(startup, 'Second Brain.lnk');
    const on = await put({ system: { runAtLogin: true } });
    expect(on.json().system).toEqual({
      runAtLogin: true,
      runAtLoginSupported: true,
      platform: 'windows',
    });
    expect(readFileSync(lnk, 'utf8')).toBe('lnk');
    expect(stored().system.runAtLogin).toBe(true);
    await put({ system: { runAtLogin: true }, ui: { theme: 'dark' } }); // resent section
    expect(powerShellRuns).toBe(1); // nothing to change on disk: no PowerShell
    const off = await put({ system: { runAtLogin: false } });
    expect(off.json().system.runAtLogin).toBe(false);
    expect(() => readFileSync(lnk)).toThrow();
  });

  it('concurrent PUTs never lose a field', async () => {
    const results = await Promise.all([
      put({ ui: { palette: 'hoa-dao' } }),
      put({ ui: { language: 'en' } }),
      put({ reminders: { time: '06:15' } }),
      put({ ai: { chatModel: 'model-a' } }),
      put({ ui: { name: 'Nhi' } }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    const view = (await t.call('GET', '/api/settings')).json();
    expect(view.ui).toMatchObject({ palette: 'hoa-dao', language: 'en', name: 'Nhi' });
    expect(view.reminders.time).toBe('06:15');
    expect(view.ai.chatModel).toBe('model-a');
    expect(stored()).toMatchObject({
      ui: { palette: 'hoa-dao', language: 'en', name: 'Nhi' },
      reminders: { time: '06:15' },
      ai: { chatModel: 'model-a' },
    });
    expect(stored().sessionToken).toBe(t.settings.sessionToken);
  });
});

describe('run at login off Windows', () => {
  it('is reported unsupported and cannot be turned on (400 unsupported-platform)', async () => {
    const home = makeTempDir('sb no startup Linux');
    mkdirSync(path.join(home, 'vault'));
    const t = await createVaultTestApp(PORT + 1, {
      home,
      platform: 'linux',
      runAtLogin: createRunAtLoginService({ appDir: home, platform: 'linux' }),
    });
    try {
      const view = (await t.call('GET', '/api/settings')).json();
      expect(view.system).toEqual({
        runAtLogin: false,
        runAtLoginSupported: false,
        platform: 'other',
      });
      const res = await t.call('PUT', '/api/settings', { system: { runAtLogin: true } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.details).toEqual({
        field: 'system.runAtLogin',
        reason: 'unsupported-platform',
      });
      expect(
        (await t.call('PUT', '/api/settings', { system: { runAtLogin: false } })).statusCode,
      ).toBe(200);
    } finally {
      await t.close();
      removeDir(home);
    }
  });
});
